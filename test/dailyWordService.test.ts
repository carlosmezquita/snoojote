import { beforeEach, describe, expect, test } from 'bun:test';
import {
    DailyWordService,
    type DailyWordCacheEntry,
    type DailyWordStore,
    type PreparedDailyWord,
} from '../src/features/dailyWord/services/dailyWordService.js';
import { type FetchResult } from '../src/features/dailyWord/services/raeService.js';

const definitionData = {
    word: 'alba',
    meanings: [{ senses: [{ raw: 'Primera luz del dia.', description: 'Amanecer.' }] }],
};

class MemoryDailyWordStore implements DailyWordStore {
    private entries = new Map<string, DailyWordCacheEntry>();

    async get(dateKey: string) {
        const entry = this.entries.get(dateKey);
        return entry ? structuredClone(entry) : null;
    }

    async upsert(entry: DailyWordCacheEntry) {
        this.entries.set(entry.dateKey, structuredClone(entry));
    }
}

const createRae = (words: Array<string | null>, definitions: FetchResult[]) => ({
    fetchWordOfTheDayCalls: 0,
    fetchWordDefinitionCalls: 0,
    async fetchWordOfTheDay() {
        const result = words[this.fetchWordOfTheDayCalls] ?? null;
        this.fetchWordOfTheDayCalls += 1;
        return result;
    },
    async fetchWordDefinition(_word: string) {
        const result = definitions[this.fetchWordDefinitionCalls] ?? {
            data: null,
            suggestions: [],
        };
        this.fetchWordDefinitionCalls += 1;
        return result;
    },
});

const createLogger = () => ({
    entries: [] as Array<{ level: string; message: string }>,
    info(message: string) {
        this.entries.push({ level: 'info', message });
    },
    warn(message: string) {
        this.entries.push({ level: 'warn', message });
    },
    error(message: string) {
        this.entries.push({ level: 'error', message });
    },
});

const createService = (
    store: DailyWordStore,
    rae: ReturnType<typeof createRae>,
    logger = createLogger(),
) =>
    new DailyWordService({
        store,
        raeService: rae,
        logger,
    });

describe('DailyWordService', () => {
    let store: MemoryDailyWordStore;

    beforeEach(() => {
        store = new MemoryDailyWordStore();
    });

    test('prefetches and stores a prepared daily word for the Spain date', async () => {
        const rae = createRae(['alba'], [{ data: definitionData, suggestions: [] }]);
        const service = createService(store, rae);

        const result = await service.prepareDailyWord(new Date('2026-05-14T05:00:00Z'));

        expect(result.status).toBe('prepared');
        expect(rae.fetchWordOfTheDayCalls).toBe(1);
        expect(await store.get('2026-05-14')).toMatchObject({
            dateKey: '2026-05-14',
            status: 'prepared',
            word: 'alba',
            attempts: 1,
        });
    });

    test('does not refetch after restart when today is already prepared', async () => {
        await store.upsert({
            dateKey: '2026-05-14',
            status: 'prepared',
            word: 'alba',
            definitionData,
            attempts: 1,
            firstAttemptAt: new Date('2026-05-14T05:00:00Z'),
            lastAttemptAt: new Date('2026-05-14T05:00:00Z'),
            nextAttemptAt: null,
            preparedAt: new Date('2026-05-14T05:00:00Z'),
            postedAt: null,
            lastError: null,
        });
        const rae = createRae(['otro'], [{ data: definitionData, suggestions: [] }]);
        const service = createService(store, rae);

        const result = await service.prepareDailyWord(new Date('2026-05-14T06:30:00Z'));

        expect(result.status).toBe('already-prepared');
        expect(rae.fetchWordOfTheDayCalls).toBe(0);
    });

    test('records failures with longer cooldowns until the 10:00 deadline', async () => {
        const rae = createRae([null, null], []);
        const service = createService(store, rae);

        const first = await service.prepareDailyWord(new Date('2026-05-14T05:00:00Z'));
        const second = await service.prepareDailyWord(new Date('2026-05-14T05:15:00Z'));

        expect(first.status).toBe('failed');
        expect(second.status).toBe('failed');
        expect(await store.get('2026-05-14')).toMatchObject({
            status: 'pending',
            attempts: 2,
            lastError: 'Could not fetch word of the day.',
            nextAttemptAt: new Date('2026-05-14T05:45:00Z'),
        });
    });

    test('skips retry when persisted cooldown is not due yet', async () => {
        const rae = createRae([null], []);
        const service = createService(store, rae);

        await service.prepareDailyWord(new Date('2026-05-14T05:00:00Z'));
        const result = await service.prepareDailyWord(new Date('2026-05-14T05:05:00Z'));

        expect(result.status).toBe('cooldown');
        expect(rae.fetchWordOfTheDayCalls).toBe(1);
    });

    test('returns no prepared payload at 10:00 when all attempts failed', async () => {
        await store.upsert({
            dateKey: '2026-05-14',
            status: 'pending',
            word: null,
            definitionData: null,
            attempts: 4,
            firstAttemptAt: new Date('2026-05-14T05:00:00Z'),
            lastAttemptAt: new Date('2026-05-14T07:15:00Z'),
            nextAttemptAt: new Date('2026-05-14T08:15:00Z'),
            preparedAt: null,
            postedAt: null,
            lastError: 'Could not fetch word of the day.',
        });
        const service = createService(store, createRae(['alba'], []));

        await expect(
            service.getPreparedDailyWord(new Date('2026-05-14T08:00:00Z')),
        ).resolves.toBeNull();
    });

    test('prepared payload is reusable until the caller confirms it was posted', async () => {
        await store.upsert({
            dateKey: '2026-05-14',
            status: 'prepared',
            word: 'alba',
            definitionData,
            attempts: 1,
            firstAttemptAt: new Date('2026-05-14T05:00:00Z'),
            lastAttemptAt: new Date('2026-05-14T05:00:00Z'),
            nextAttemptAt: null,
            preparedAt: new Date('2026-05-14T05:00:00Z'),
            postedAt: null,
            lastError: null,
        });
        const service = createService(store, createRae([], []));

        const prepared = await service.getPreparedDailyWord(new Date('2026-05-14T08:00:00Z'));
        const retryBeforeSendConfirmation = await service.getPreparedDailyWord(
            new Date('2026-05-14T08:01:00Z'),
        );

        expect(prepared).toEqual({
            word: 'alba',
            definitionData,
        } satisfies PreparedDailyWord);
        expect(retryBeforeSendConfirmation).toEqual(prepared);
        expect(await store.get('2026-05-14')).toMatchObject({
            status: 'prepared',
            postedAt: null,
        });
    });

    test('marking as posted prevents duplicate sends after Discord accepts the message', async () => {
        await store.upsert({
            dateKey: '2026-05-14',
            status: 'prepared',
            word: 'alba',
            definitionData,
            attempts: 1,
            firstAttemptAt: new Date('2026-05-14T05:00:00Z'),
            lastAttemptAt: new Date('2026-05-14T05:00:00Z'),
            nextAttemptAt: null,
            preparedAt: new Date('2026-05-14T05:00:00Z'),
            postedAt: null,
            lastError: null,
        });
        const service = createService(store, createRae([], []));

        await service.markDailyWordPosted(new Date('2026-05-14T08:00:00Z'));
        const duplicate = await service.getPreparedDailyWord(new Date('2026-05-14T08:01:00Z'));

        expect(duplicate).toBeNull();
        expect(await store.get('2026-05-14')).toMatchObject({
            status: 'posted',
            postedAt: new Date('2026-05-14T08:00:00Z'),
        });
    });
});
