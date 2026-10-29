import { describe, expect, test } from 'bun:test';
import {
    getDailyReward,
    getNewMilestones,
    getSpainDateKey,
    getStreakDateKey,
    isWithinGracePeriod,
} from '../src/features/streaks/services/streakRules.js';

describe('streakRules', () => {
    test('uses Spain calendar dates', () => {
        expect(getSpainDateKey(new Date('2026-05-12T21:59:00Z'))).toBe('2026-05-12');
        expect(getSpainDateKey(new Date('2026-05-12T22:01:00Z'))).toBe('2026-05-13');
    });

    test.each([
        ['2026-01-12T12:59:59.999Z', '2026-01-11'],
        ['2026-01-12T13:00:00Z', '2026-01-12'],
        ['2026-05-12T11:59:59.999Z', '2026-05-11'],
        ['2026-05-12T12:00:00Z', '2026-05-12'],
        ['2026-05-12T22:01:00Z', '2026-05-12'],
        ['2026-03-29T11:59:59Z', '2026-03-28'],
        ['2026-03-29T12:00:00Z', '2026-03-29'],
        ['2026-10-25T12:59:59Z', '2026-10-24'],
        ['2026-10-25T13:00:00Z', '2026-10-25'],
        ['2027-01-01T12:59:59Z', '2026-12-31'],
    ])('uses the 14:00 Madrid streak boundary at %s', (instant, expected) => {
        expect(getStreakDateKey(new Date(instant))).toBe(expected);
    });

    test('allows a 36-hour grace period', () => {
        const last = new Date('2026-05-11T08:00:00Z');

        expect(isWithinGracePeriod(last, new Date('2026-05-12T19:59:00Z'))).toBe(true);
        expect(isWithinGracePeriod(last, new Date('2026-05-12T20:01:00Z'))).toBe(false);
    });

    test('calculates progressive daily reward', () => {
        expect(getDailyReward(0)).toBe(150);
        expect(getDailyReward(100)).toBe(350);
        expect(getDailyReward(500)).toBe(500);
    });

    test('returns only newly reached milestone bonuses', () => {
        expect(getNewMilestones(30, [7])).toEqual([30]);
        expect(getNewMilestones(365, [7, 30, 100])).toEqual([365]);
        expect(getNewMilestones(6, [])).toEqual([]);
    });
});
