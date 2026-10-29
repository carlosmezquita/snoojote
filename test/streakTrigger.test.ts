import { describe, expect, spyOn, test } from 'bun:test';
import { config } from '../src/config.js';
import { execute } from '../src/features/streaks/events/messageCreate.js';
import streakService from '../src/features/streaks/services/StreakService.js';

describe('streak message trigger', () => {
    test('requires spaincraft in the main channel and ignores bots and DMs', async () => {
        const handler = spyOn(streakService, 'handleStreak').mockResolvedValue(undefined);
        const message = {
            content: 'SpainCraft',
            channelId: config.channels.main,
            author: { bot: false },
            guild: { id: 'guild' },
        };
        try {
            for (const override of [
                { content: 'any sufficiently long message' },
                { content: '' },
                { channelId: 'another-channel' },
                { author: { bot: true } },
                { guild: null },
            ]) {
                await execute({ ...message, ...override } as never, {} as never);
            }
            expect(handler).not.toHaveBeenCalled();
            for (const content of ['spaincraft', 'SPAINCRAFT', 'Hola Spaincraft!']) {
                await execute({ ...message, content } as never, {} as never);
            }
            expect(handler).toHaveBeenCalledTimes(3);
        } finally {
            handler.mockRestore();
        }
    });
});
