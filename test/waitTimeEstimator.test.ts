import { describe, expect, test } from 'bun:test';
import {
    buildResponderPool,
    computeAlpha,
    computeLoadFactor,
    computeMedian,
    computeRecentParticipationFactor,
    computeWeightedStaffCapacity,
    estimateWaitTimeMs,
    formatDuration,
    getTimeBlock,
} from '../src/features/tickets/services/waitTimeEstimator.js';

const minutes = (value: number) => value * 60 * 1000;

const answeredTicket = (
    createdAt: string,
    responseMinutes: number,
    context?: { staffCapacityAtCreation?: number; openTicketsAtCreation?: number },
) => ({
    createdAt: new Date(createdAt),
    firstResponseAt: new Date(new Date(createdAt).getTime() + minutes(responseMinutes)),
    ...context,
});

const staffSamples = (now: Date, values: number[], ageDays = 1) =>
    values.map((value, index) => ({
        occurredAt: new Date(now.getTime() - (ageDays + index) * 24 * 60 * 60 * 1000),
        responseTimeMs: minutes(value),
    }));

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

    test('per-staff statistics distinguish fast and slow responders', () => {
        const now = new Date('2026-05-12T12:00:00Z');
        const pool = buildResponderPool(
            [
                {
                    staffId: 'fast',
                    status: 'online',
                    firstResponseSamples: staffSamples(now, [4, 5, 6, 7, 8]),
                },
                {
                    staffId: 'slow',
                    status: 'online',
                    firstResponseSamples: staffSamples(now, [45, 50, 55, 60, 65]),
                },
            ],
            minutes(20),
            now,
        );

        expect(pool.find((entry) => entry.staffId === 'fast')?.baselineMs).toBe(minutes(6));
        expect(pool.find((entry) => entry.staffId === 'slow')?.baselineMs).toBe(minutes(55));
    });

    test('low-sample and old staff history falls back to global baseline', () => {
        const now = new Date('2026-05-12T12:00:00Z');
        const pool = buildResponderPool(
            [
                {
                    staffId: 'low-sample',
                    status: 'online',
                    firstResponseSamples: staffSamples(now, [2, 3, 4]),
                },
                {
                    staffId: 'old-history',
                    status: 'online',
                    firstResponseSamples: staffSamples(now, [2, 3, 4, 5, 6], 91),
                },
            ],
            minutes(20),
            now,
        );

        expect(pool.every((entry) => entry.baselineMs === minutes(20))).toBe(true);
        expect(pool.every((entry) => !entry.usesStaffBaseline)).toBe(true);
    });

    test('weighted responder pool favors online staff and boosts recent participants modestly', () => {
        expect(
            computeWeightedStaffCapacity([
                { staffId: 'online', status: 'online' },
                { staffId: 'idle', status: 'idle' },
                { staffId: 'dnd', status: 'dnd' },
                { staffId: 'offline', status: 'offline' },
                { staffId: 'bot', status: 'online', isBot: true },
            ]),
        ).toBe(1.75);

        expect(computeRecentParticipationFactor(0)).toBe(1);
        expect(computeRecentParticipationFactor(3)).toBeCloseTo(1.24);
        expect(computeRecentParticipationFactor(50)).toBe(1.4);
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

        expect(
            estimateWaitTimeMs({
                recentTickets,
                temporalTickets,
                allTickets: temporalTickets,
                now,
                queueLength: 0,
                activeStaff: 1,
            }),
        ).toBe(minutes(21));
    });

    test('per-staff baseline affects estimate only with enough samples', () => {
        const now = new Date('2026-05-12T12:00:00Z');
        const allTickets = [
            answeredTicket('2026-05-12T11:00:00Z', 30, {
                staffCapacityAtCreation: 1,
                openTicketsAtCreation: 0,
            }),
            answeredTicket('2026-05-12T10:00:00Z', 30, {
                staffCapacityAtCreation: 1,
                openTicketsAtCreation: 0,
            }),
        ];

        const lowSampleEstimate = estimateWaitTimeMs({
            recentTickets: allTickets,
            temporalTickets: [],
            allTickets,
            now,
            queueLength: 0,
            staffProfiles: [
                {
                    staffId: 'fast',
                    status: 'online',
                    firstResponseSamples: staffSamples(now, [4, 5, 6]),
                },
            ],
        });
        const enoughSampleEstimate = estimateWaitTimeMs({
            recentTickets: allTickets,
            temporalTickets: [],
            allTickets,
            now,
            queueLength: 0,
            staffProfiles: [
                {
                    staffId: 'fast',
                    status: 'online',
                    firstResponseSamples: staffSamples(now, [4, 5, 6, 7, 8]),
                },
            ],
        });

        expect(lowSampleEstimate).toBe(minutes(30));
        expect(enoughSampleEstimate).toBe(minutes(22.8));
    });

    test('global fallback works without per-staff history', () => {
        const now = new Date('2026-05-12T12:00:00Z');
        expect(
            estimateWaitTimeMs({
                recentTickets: [],
                temporalTickets: [],
                allTickets: [answeredTicket('2026-05-11T12:00:00Z', 18)],
                now,
                queueLength: 0,
                staffProfiles: [],
                activeStaff: 1,
            }),
        ).toBe(minutes(18));
    });

    test('queue load increases estimates when queue is high or capacity is low', () => {
        const now = new Date('2026-05-12T12:00:00Z');
        const allTickets = [
            answeredTicket('2026-05-12T11:00:00Z', 10, {
                staffCapacityAtCreation: 2,
                openTicketsAtCreation: 1,
            }),
            answeredTicket('2026-05-12T10:00:00Z', 10, {
                staffCapacityAtCreation: 2,
                openTicketsAtCreation: 1,
            }),
        ];
        const baseInput = {
            recentTickets: allTickets,
            temporalTickets: [],
            allTickets,
            now,
        };

        const normalLoad = estimateWaitTimeMs({
            ...baseInput,
            queueLength: 1,
            staffProfiles: [{ staffId: 'online', status: 'online' }],
        });
        const highLoad = estimateWaitTimeMs({
            ...baseInput,
            queueLength: 5,
            staffProfiles: [{ staffId: 'idle', status: 'idle' }],
        });

        expect(highLoad).toBeGreaterThan(normalLoad);
    });

    test('formats capped duration as 24+ hours', () => {
        expect(formatDuration(24 * 60 * 60 * 1000)).toBe('24+ hours');
        expect(formatDuration(minutes(61))).toBe('1 hour 1 minute');
    });
});
