import { type WordEntryData, type RAEService } from './raeService.js';

export type DailyWordCacheStatus = 'pending' | 'prepared' | 'posted';

export interface DailyWordCacheEntry {
    dateKey: string;
    status: DailyWordCacheStatus;
    word: string | null;
    definitionData: WordEntryData | null;
    attempts: number;
    firstAttemptAt: Date | null;
    lastAttemptAt: Date | null;
    nextAttemptAt: Date | null;
    preparedAt: Date | null;
    postedAt: Date | null;
    lastError: string | null;
}

export interface PreparedDailyWord {
    word: string;
    definitionData: WordEntryData;
}

export interface DailyWordStore {
    get(dateKey: string): Promise<DailyWordCacheEntry | null>;
    upsert(entry: DailyWordCacheEntry): Promise<void>;
}

export interface DailyWordLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export type PrepareDailyWordStatus =
    | 'prepared'
    | 'already-prepared'
    | 'already-posted'
    | 'cooldown'
    | 'not-started'
    | 'expired'
    | 'failed';

interface DailyWordServiceOptions {
    store: DailyWordStore;
    raeService: Pick<RAEService, 'fetchWordOfTheDay' | 'fetchWordDefinition'>;
    logger: DailyWordLogger;
}

const SPAIN_TIME_ZONE = 'Europe/Madrid';
const START_HOUR = 7;
const DEADLINE_HOUR = 10;
const RETRY_COOLDOWNS_MINUTES = [15, 30, 45, 60, 90, 120];

export class DailyWordService {
    private readonly store: DailyWordStore;
    private readonly raeService: Pick<RAEService, 'fetchWordOfTheDay' | 'fetchWordDefinition'>;
    private readonly logger: DailyWordLogger;

    constructor(options: DailyWordServiceOptions) {
        this.store = options.store;
        this.raeService = options.raeService;
        this.logger = options.logger;
    }

    async prepareDailyWord(now = new Date()): Promise<{ status: PrepareDailyWordStatus }> {
        const dateKey = getSpainDateKey(now);
        const existing = await this.store.get(dateKey);

        if (existing?.status === 'posted') {
            this.logger.info(`Daily Word prefetch skipped for ${dateKey}; already posted.`);
            return { status: 'already-posted' };
        }

        if (existing?.status === 'prepared' && existing.word && existing.definitionData) {
            this.logger.info(`Daily Word prefetch skipped for ${dateKey}; already prepared.`);
            return { status: 'already-prepared' };
        }

        if (!isAtOrAfterStart(now)) {
            this.logger.info(
                `Daily Word prefetch skipped for ${dateKey}; retry window starts at 07:00 Europe/Madrid.`,
            );
            return { status: 'not-started' };
        }

        if (!isBeforeDeadline(now)) {
            this.logger.warn(
                `Daily Word prefetch skipped for ${dateKey}; retry window ended at 10:00 Europe/Madrid.`,
            );
            return { status: 'expired' };
        }

        if (existing?.nextAttemptAt && existing.nextAttemptAt > now) {
            this.logger.info(
                `Daily Word prefetch for ${dateKey} is waiting for cooldown until ${existing.nextAttemptAt.toISOString()}.`,
            );
            return { status: 'cooldown' };
        }

        const attempts = (existing?.attempts ?? 0) + 1;
        const firstAttemptAt = existing?.firstAttemptAt ?? now;

        this.logger.info(`Daily Word prefetch attempt ${attempts} started for ${dateKey}.`);

        const prepared = await this.fetchPreparedDailyWord();

        if (prepared) {
            await this.store.upsert({
                dateKey,
                status: 'prepared',
                word: prepared.word,
                definitionData: prepared.definitionData,
                attempts,
                firstAttemptAt,
                lastAttemptAt: now,
                nextAttemptAt: null,
                preparedAt: now,
                postedAt: null,
                lastError: null,
            });

            this.logger.info(`Daily Word prefetch succeeded for ${dateKey}: ${prepared.word}.`);
            return { status: 'prepared' };
        }

        const nextAttemptAt = getNextAttemptAt(now, attempts);

        await this.store.upsert({
            dateKey,
            status: 'pending',
            word: null,
            definitionData: null,
            attempts,
            firstAttemptAt,
            lastAttemptAt: now,
            nextAttemptAt,
            preparedAt: null,
            postedAt: null,
            lastError: 'Could not fetch word of the day.',
        });

        if (nextAttemptAt) {
            this.logger.warn(
                `Daily Word prefetch attempt ${attempts} failed for ${dateKey}; retry after ${nextAttemptAt.toISOString()}.`,
            );
        } else {
            this.logger.error(
                `Daily Word prefetch attempt ${attempts} failed for ${dateKey}; no retries remain before 10:00 Europe/Madrid.`,
            );
        }

        return { status: 'failed' };
    }

    async getPreparedDailyWord(now = new Date()): Promise<PreparedDailyWord | null> {
        const dateKey = getSpainDateKey(now);
        const entry = await this.store.get(dateKey);

        if (!entry) {
            this.logger.warn(`Daily Word post skipped for ${dateKey}; no prefetch state found.`);
            return null;
        }

        if (entry.status === 'posted') {
            this.logger.warn(`Daily Word post skipped for ${dateKey}; already posted.`);
            return null;
        }

        if (entry.status !== 'prepared' || !entry.word || !entry.definitionData) {
            this.logger.error(
                `Daily Word post skipped for ${dateKey}; no prepared word available after ${entry.attempts} prefetch attempt(s).`,
            );
            return null;
        }

        this.logger.info(`Daily Word prepared payload loaded for ${dateKey}: ${entry.word}.`);
        return {
            word: entry.word,
            definitionData: entry.definitionData,
        };
    }

    async markDailyWordPosted(now = new Date()): Promise<void> {
        const dateKey = getSpainDateKey(now);
        const entry = await this.store.get(dateKey);

        if (!entry) {
            this.logger.warn(`Daily Word post mark skipped for ${dateKey}; no state found.`);
            return;
        }

        await this.store.upsert({
            ...entry,
            status: 'posted',
            postedAt: now,
        });

        this.logger.info(`Daily Word marked as posted for ${dateKey}.`);
    }

    private async fetchPreparedDailyWord(): Promise<PreparedDailyWord | null> {
        const word = await this.raeService.fetchWordOfTheDay();
        if (!word) {
            return null;
        }

        const fetchResult = await this.raeService.fetchWordDefinition(word);
        if (!fetchResult.data) {
            return null;
        }

        return {
            word,
            definitionData: fetchResult.data,
        };
    }
}

export const getSpainDateKey = (date: Date) => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: SPAIN_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
};

const isBeforeDeadline = (date: Date) => getSpainHour(date) < DEADLINE_HOUR;

const isAtOrAfterStart = (date: Date) => getSpainHour(date) >= START_HOUR;

export const getSpainHour = (date: Date) => {
    const hour = new Intl.DateTimeFormat('en-GB', {
        timeZone: SPAIN_TIME_ZONE,
        hour: '2-digit',
        hourCycle: 'h23',
    }).format(date);

    return Number(hour);
};

const getNextAttemptAt = (now: Date, attempts: number) => {
    const cooldownMinutes =
        RETRY_COOLDOWNS_MINUTES[Math.min(attempts - 1, RETRY_COOLDOWNS_MINUTES.length - 1)];
    const nextAttemptAt = new Date(now.getTime() + cooldownMinutes * 60_000);

    return isBeforeDeadline(nextAttemptAt) ? nextAttemptAt : null;
};
