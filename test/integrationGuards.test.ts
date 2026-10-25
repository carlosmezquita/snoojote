import { describe, expect, test } from 'bun:test';
import { AIMessageChunk } from '@langchain/core/messages';
import { createAiHandler } from '../src/features/ai/events/messageCreate.js';
import { RAEService } from '../src/features/dailyWord/services/raeService.js';
import { readJson } from '../src/shared/utils/http.js';
import { config } from '../src/config.js';

function message(id: string, replies: unknown[]) {
    return {
        author: { id, bot: false },
        guild: { id: 'guild' },
        guildId: 'guild',
        channelId: config.channels.ai,
        content: '@bot hello',
        mentions: { has: () => true },
        channel: { sendTyping: async () => {} },
        reply: async (payload: unknown) => {
            replies.push(payload);
        },
    };
}
const client = { user: { id: 'bot' } };

describe('AI resource and output guards', () => {
    test('bounds global concurrency and does not amplify a busy burst into reply spam', async () => {
        let calls = 0;
        let release!: () => void;
        const wait = new Promise<void>((resolve) => {
            release = resolve;
        });
        const handler = createAiHandler(() => ({
            getResponse: async () => {
                calls++;
                await wait;
                return new AIMessageChunk('hello');
            },
        }));
        const replies: unknown[] = [];
        const jobs = Array.from({ length: 100 }, (_, i) =>
            handler.execute(message(String(i), replies) as never, client as never),
        );
        await new Promise(setImmediate);
        expect(calls).toBe(config.ai.maxConcurrent);
        expect(replies).toHaveLength(1);
        release();
        await Promise.all(jobs);
        await handler.execute(message('new-user', replies) as never, client as never);
        expect(calls).toBe(config.ai.maxConcurrent + 1);
    });

    test('per-user cooldown suppresses concurrent repeat requests and output cannot mass-mention', async () => {
        let calls = 0;
        const replies: any[] = [];
        const handler = createAiHandler(() => ({
            getResponse: async () => {
                calls++;
                return new AIMessageChunk({ content: [{ type: 'text', text: '@everyone hello' }] });
            },
        }));
        await Promise.all(
            Array.from({ length: 100 }, () =>
                handler.execute(message('same-user', replies) as never, client as never),
            ),
        );
        expect(calls).toBe(1);
        expect(replies[0].allowedMentions).toEqual({ parse: [], repliedUser: false });
        expect(replies[0].content).toBe('@everyone hello');
    });

    test('request capacity is released when the provider rejects', async () => {
        let calls = 0;
        const replies: unknown[] = [];
        const handler = createAiHandler(() => ({
            getResponse: async () => {
                calls++;
                throw new Error('Unavailable');
            },
        }));
        for (let i = 0; i < 5; i++)
            await handler.execute(message(String(i), replies) as never, client as never);
        expect(calls).toBe(5);
    });
});

describe('dictionary HTTP boundary', () => {
    test('coalesces identical requests and bounds distinct in-flight lookups', async () => {
        let calls = 0;
        let release!: () => void;
        const wait = new Promise<void>((resolve) => {
            release = resolve;
        });
        const service = new RAEService(async () => {
            calls++;
            await wait;
            return Response.json({ ok: true, data: { word: 'test', meanings: [] } });
        });
        const same = Array.from({ length: 20 }, () => service.fetchWordDefinition('same'));
        const different = Array.from({ length: 20 }, (_, i) =>
            service.fetchWordDefinition(`other-${i}`),
        );
        await new Promise(setImmediate);
        expect(calls).toBe(4);
        release();
        const results = await Promise.all([...same, ...different]);
        expect(results.filter((result) => result.data)).toHaveLength(23);
        expect((await service.fetchWordDefinition('after')).data?.word).toBe('test');
    });
    test('rejects oversized chunked bodies', async () => {
        await expect(
            readJson(new Response(JSON.stringify({ text: 'x'.repeat(500) })), 100),
        ).rejects.toThrow('size limit');
    });
    test('rejects malformed provider data instead of passing it to embed rendering', async () => {
        const service = new RAEService(async () =>
            Response.json({ ok: true, data: { word: 'test', meanings: 'wrong type' } }),
        );
        expect(await service.fetchWordDefinition('test')).toEqual({
            data: null,
            suggestions: [],
            unavailable: true,
        });
    });
    test('sets a request deadline and URL-encodes dictionary input', async () => {
        let requested = '';
        let timed = false;
        const service = new RAEService(
            async (url: string | URL | Request, options?: RequestInit) => {
                requested = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
                timed = options?.signal instanceof AbortSignal;
                return Response.json({ ok: true, data: { word: 'test', meanings: [] } });
            },
        );
        expect((await service.fetchWordDefinition('a/b?c')).data?.word).toBe('test');
        expect(requested).toEndWith('a%2Fb%3Fc');
        expect(timed).toBe(true);
    });
});
