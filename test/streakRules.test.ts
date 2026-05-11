import { describe, expect, test } from 'bun:test';
import {
    getDailyReward,
    getNewMilestones,
    getSpainDateKey,
    isWithinGracePeriod,
} from '../src/features/streaks/services/streakRules.js';

describe('streakRules', () => {
    test('uses Spain calendar dates', () => {
        expect(getSpainDateKey(new Date('2026-05-12T21:59:00Z'))).toBe('2026-05-12');
        expect(getSpainDateKey(new Date('2026-05-12T22:01:00Z'))).toBe('2026-05-13');
    });

    test('allows a 36-hour grace period', () => {
        const last = new Date('2026-05-11T08:00:00Z');

        expect(isWithinGracePeriod(last, new Date('2026-05-12T19:59:00Z'))).toBe(true);
        expect(isWithinGracePeriod(last, new Date('2026-05-12T20:01:00Z'))).toBe(false);
    });

    test('calculates progressive daily reward', () => {
        expect(getDailyReward(0)).toBe(250);
        expect(getDailyReward(100)).toBe(750);
    });

    test('returns only newly reached milestone bonuses', () => {
        expect(getNewMilestones(30, [7])).toEqual([30]);
        expect(getNewMilestones(365, [7, 30, 100])).toEqual([365]);
        expect(getNewMilestones(6, [])).toEqual([]);
    });
});
