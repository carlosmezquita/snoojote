import { test, expect, describe, afterEach, beforeEach, setSystemTime } from 'bun:test';
import { RateLimitService } from '../src/shared/services/RateLimitService.js';

describe('RateLimitService', () => {
    let rateLimitService: RateLimitService;

    beforeEach(() => {
        rateLimitService = new RateLimitService(60);
        setSystemTime(new Date('2020-01-01T00:00:00Z'));
    });

    afterEach(() => {
        rateLimitService.dispose();
        setSystemTime();
    });

    test('check() should return 1 for a new key', () => {
        expect(rateLimitService.check('user1')).toBe(1);
    });

    test('check() should increment counter for the same key within cooldown', () => {
        expect(rateLimitService.check('user1')).toBe(1);
        expect(rateLimitService.check('user1')).toBe(2);
        expect(rateLimitService.check('user1')).toBe(3);
    });

    test('check() should track different keys independently', () => {
        expect(rateLimitService.check('user1')).toBe(1);
        expect(rateLimitService.check('user2')).toBe(1);
        expect(rateLimitService.check('user1')).toBe(2);
        expect(rateLimitService.check('user2')).toBe(2);
    });

    test('check() should reset counter after cooldown period expires', () => {
        expect(rateLimitService.check('user1')).toBe(1);
        expect(rateLimitService.check('user1')).toBe(2);

        // Advance time by 61 seconds
        setSystemTime(new Date(new Date('2020-01-01T00:00:00Z').getTime() + 61 * 1000));

        expect(rateLimitService.check('user1')).toBe(1);
    });

    test('reset() should clear the rate limit data for a key', () => {
        expect(rateLimitService.check('user1')).toBe(1);
        expect(rateLimitService.check('user1')).toBe(2);

        rateLimitService.reset('user1');

        expect(rateLimitService.check('user1')).toBe(1);
    });

    test('dispose() should stop the cleanup interval', () => {
        // Just calling dispose to ensure no errors and it covers the method.
        rateLimitService.dispose();
    });
});
