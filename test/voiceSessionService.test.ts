import { describe, expect, test } from 'bun:test';
import { VoiceSessionService } from '../src/features/economy/services/voiceSessionService.js';

describe('VoiceSessionService', () => {
    test('counts whole elapsed minutes and preserves partial remainder', () => {
        const service = new VoiceSessionService();

        service.start('user-1', 'voice-1', 0);

        expect(service.collectElapsed('user-1', 119_000)).toEqual({
            channelId: 'voice-1',
            minutes: 1,
        });
        expect(service.collectElapsed('user-1', 119_000)).toEqual({
            channelId: 'voice-1',
            minutes: 0,
        });
        expect(service.collectElapsed('user-1', 180_000)).toEqual({
            channelId: 'voice-1',
            minutes: 2,
        });
    });

    test('returns elapsed time for old channel when switching channels', () => {
        const service = new VoiceSessionService();

        service.start('user-1', 'voice-1', 0);

        expect(service.switchChannel('user-1', 'voice-2', 30 * 60_000)).toEqual({
            channelId: 'voice-1',
            minutes: 30,
        });
        expect(service.getSession('user-1')).toEqual({
            channelId: 'voice-2',
            startedAt: 30 * 60_000,
        });
    });
});
