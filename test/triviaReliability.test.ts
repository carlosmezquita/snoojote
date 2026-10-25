import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { TriviaService } from '../src/features/trivia/services/TriviaService.js';
import {
    name as dailyWordEvent,
    once as dailyWordOnce,
} from '../src/features/dailyWord/events/dailyWord.js';
import { Events } from 'discord.js';

const folders: string[] = [];
afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function fixture() {
    const folder = mkdtempSync(path.join(tmpdir(), 'snoojote-trivia-'));
    folders.push(folder);
    const file = path.join(folder, 'questions.json');
    writeFileSync(
        file,
        JSON.stringify({ current_id: 0, unread_questions: ['Question?'], read_questions: [] }),
    );
    const client = {
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        channels: { fetch: async () => ({ send: async () => {} }) },
    };
    return { file, folder, service: new TriviaService(file, 0), client };
}
describe('daily question reliability', () => {
    test('scheduler and manual invocations cannot concurrently publish the same day', async () => {
        const f = fixture();
        let sent = 0;
        const channel = {
            send: async () => {
                sent++;
                await Promise.resolve();
                return { startThread: async () => ({ leave: async () => {} }) };
            },
        };
        const results = await Promise.all(
            Array.from({ length: 10 }, () =>
                f.service.processDailyQuestion(channel as never, f.client as never),
            ),
        );
        expect(sent).toBe(1);
        expect(results.filter(Boolean)).toHaveLength(1);
        const data = JSON.parse(readFileSync(f.file, 'utf8'));
        expect(data.read_questions).toHaveLength(1);
        expect(data.unread_questions).toHaveLength(0);
        expect(readdirSync(f.folder)).toEqual(['questions.json']);
    });
    test('failed delivery preserves the question bank and reuses the retry nonce', async () => {
        const f = fixture();
        const before = readFileSync(f.file, 'utf8');
        const nonces: string[] = [];
        const channel = {
            send: async (payload: { nonce: string }) => {
                nonces.push(payload.nonce);
                throw new Error('Unavailable');
            },
        };
        expect(await f.service.processDailyQuestion(channel as never, f.client as never)).toBe(
            false,
        );
        expect(readFileSync(f.file, 'utf8')).toBe(before);
        expect(nonces).toHaveLength(3);
        expect(new Set(nonces).size).toBe(1);
    });
    test('daily word registers the current ready event once', () => {
        expect(dailyWordEvent).toBe(Events.ClientReady);
        expect(dailyWordOnce).toBe(true);
    });
});
