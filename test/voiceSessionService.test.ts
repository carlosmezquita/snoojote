import { expect, test } from 'bun:test';
import { datedMinutes } from '../src/features/economy/services/voiceSessionService.js';
import { getSpainDateKey } from '../src/features/streaks/services/streakRules.js';
test('voice settlement splits Madrid dates and preserves its partial minute', () => {
    const start = Date.parse('2026-05-15T21:50:00Z');
    const result = datedMinutes('voice', start, start + 20 * 60_000 + 34000);
    expect(result.slices.map((x) => getSpainDateKey(x.earnedAt))).toEqual([
        '2026-05-15',
        '2026-05-16',
    ]);
    expect(result.slices.reduce((n, x) => n + x.minutes, 0)).toBe(20);
    expect(result.lastCompletion).toBe(start + 20 * 60_000);
});
test('a 25-hour DST day counts every complete minute once', () => {
    const start = Date.parse('2026-10-24T22:00:00Z');
    expect(
        datedMinutes('voice', start, start + 26 * 3600000).slices.reduce(
            (n, x) => n + x.minutes,
            0,
        ),
    ).toBe(26 * 60);
});
