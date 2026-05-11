import { describe, expect, test } from 'bun:test';
import {
    computeAlpha,
    computeLoadFactor,
    computeMedian,
    estimateWaitTimeMs,
    formatDuration,
    getTimeBlock,
} from '../src/features/tickets/services/waitTimeEstimator.js';

const minutes = (value: number) => value * 60 * 1000;

describe('waitTimeEstimator', () => {
    test('computeMedian does not mutate input', () => {
        const values = [30, 10, 20];

        expect(computeMedian(values)).toBe(20);
        expect(values).toEqual([30, 10, 20]);
    });

    test('maps hours to four-hour blocks', () => {
        expect(getTimeBlock(0)).toBe(0);
        expect(getTimeBlock(3)).toBe(0);
        expect(getTimeBlock(4)).toBe(1);
        expect(getTimeBlock(23)).toBe(5);
    });

    test('uses fresh and stale recency weights', () => {
        const now = new Date('2026-05-12T12:00:00Z');

        expect(computeAlpha(new Date('2026-05-12T00:00:00Z'), now)).toBe(0.6);
        expect(computeAlpha(new Date('2026-05-10T00:00:00Z'), now)).toBe(0.2);
        expect(computeAlpha(null, now)).toBe(0.2);
    });

    test('load factor accounts for queue and zero staff', () => {
        expect(computeLoadFactor(0, 1)).toBe(1);
        expect(computeLoadFactor(2, 3)).toBe(1);
        expect(computeLoadFactor(0, 0)).toBe(4);
    });

    test('estimates wait time from recent and temporal medians', () => {
        const now = new Date('2026-05-12T12:00:00Z');
        const recentTickets = [
            {
                createdAt: new Date('2026-05-12T11:00:00Z'),
                firstResponseAt: new Date('2026-05-12T11:10:00Z'),
            },
            {
                createdAt: new Date('2026-05-12T10:00:00Z'),
                firstResponseAt: new Date('2026-05-12T10:20:00Z'),
            },
        ];
        const temporalTickets = [
            {
                createdAt: new Date('2026-05-05T12:00:00Z'),
                firstResponseAt: new Date('2026-05-05T12:30:00Z'),
            },
            {
                createdAt: new Date('2026-05-06T12:00:00Z'),
                firstResponseAt: new Date('2026-05-06T12:30:00Z'),
            },
            {
                createdAt: new Date('2026-05-07T12:00:00Z'),
                firstResponseAt: new Date('2026-05-07T12:30:00Z'),
            },
            {
                createdAt: new Date('2026-05-08T12:00:00Z'),
                firstResponseAt: new Date('2026-05-08T12:30:00Z'),
            },
            {
                createdAt: new Date('2026-05-09T12:00:00Z'),
                firstResponseAt: new Date('2026-05-09T12:30:00Z'),
            },
        ];

        expect(estimateWaitTimeMs({
            recentTickets,
            temporalTickets,
            allTickets: temporalTickets,
            now,
            queueLength: 0,
            activeStaff: 1,
        })).toBe(minutes(21));
    });

    test('formats capped duration as 24+ hours', () => {
        expect(formatDuration(24 * 60 * 60 * 1000)).toBe('24+ hours');
        expect(formatDuration(minutes(61))).toBe('1 hour 1 minute');
    });
});
