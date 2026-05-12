import { describe, expect, test } from 'bun:test';
import { calculateCappedEarning } from '../src/features/economy/services/economyService.js';

describe('economy balance helpers', () => {
    test('caps passive earning at the configured daily limit', () => {
        expect(calculateCappedEarning(0, 5, 125)).toBe(5);
        expect(calculateCappedEarning(123, 5, 125)).toBe(2);
        expect(calculateCappedEarning(125, 5, 125)).toBe(0);
    });

    test('ignores invalid capped earning requests', () => {
        expect(calculateCappedEarning(0, 0, 125)).toBe(0);
        expect(calculateCappedEarning(0, 5, 0)).toBe(0);
    });
});
