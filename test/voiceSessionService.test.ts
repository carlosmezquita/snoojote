import { describe, expect, test } from 'bun:test';
import { VoiceSessionService } from '../src/features/economy/services/voiceSessionService.js';
import { getSpainDateKey } from '../src/features/streaks/services/streakRules.js';

describe('VoiceSessionService', () => {
    test('attributes voice minutes across Madrid midnight to their earned date', () => {
        const service = new VoiceSessionService();
        service.start('user', 'voice', Date.parse('2026-05-15T21:50:00Z'));
        const slices = service.collectDated('user', Date.parse('2026-05-15T22:10:00Z'));
        expect(slices.map((slice) => getSpainDateKey(slice.earnedAt))).toEqual([
            '2026-05-15',
            '2026-05-16',
        ]);
        expect(slices.reduce((sum, slice) => sum + slice.minutes, 0)).toBe(20);
        expect(service.collectDated('user', Date.parse('2026-05-15T22:10:00Z'))).toEqual([]);
    });

    test('handles a 25-hour DST day without losing or double-crediting minutes', () => {
        const service = new VoiceSessionService();
        const start = Date.parse('2026-10-24T22:00:00Z');
        service.start('user', 'voice', start);
        const slices = service.collectDated('user', start + 26 * 60 * 60_000, true);
        expect(slices.reduce((sum, slice) => sum + slice.minutes, 0)).toBe(26 * 60);
        expect(service.getSession('user')).toBeUndefined();
    });
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
