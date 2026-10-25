import { describe, expect, test } from 'bun:test';
import { DMService, DMType } from '../src/shared/services/DMService.js';

describe('private notification fallback', () => {
    test('closed DMs do not cause private details or files to be posted publicly', async () => {
        let payload: any;
        const user = {
            id: 'user',
            toString: () => '<@user>',
            send: async () => {
                throw new Error('DMs closed');
            },
            client: {
                channels: {
                    fetch: async () => ({
                        isTextBased: () => true,
                        send: async (value: unknown) => {
                            payload = value;
                        },
                    }),
                },
            },
        };
        const result = await DMService.sendWithFallback({
            user: user as never,
            type: DMType.Sanction,
            title: 'Private sanction',
            description: 'Sensitive detail',
            files: ['private.txt'],
        });
        expect(result.fallbackSent).toBe(true);
        expect(payload.embeds).toEqual([]);
        expect(payload.files).toEqual([]);
        expect(JSON.stringify(payload)).not.toContain('Sensitive detail');
        expect(payload.allowedMentions).toEqual({ parse: [], users: ['user'] });
    });
});
