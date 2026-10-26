import { describe, expect, test } from 'bun:test';
import {
    evaluateWaitEstimates,
    observeInitialWait,
} from '../src/features/tickets/services/waitTimeEvaluation.js';

const at = (hour: number) => new Date(Date.UTC(2026, 4, 16, hour));
describe('saved forecast evaluation', () => {
    test('uses the forecast actually issued, without learning from future responses', () => {
        const tickets = [
            { id: 1, createdAt: at(9), firstResponseAt: at(12) },
            { id: 2, createdAt: at(10), firstResponseAt: at(11) },
        ];
        const snapshots = [
            { ticketId: 1, createdAt: at(9), estimatedMs: 60_000, modelVersion: 'v1' },
            { ticketId: 2, createdAt: at(10), estimatedMs: 120_000, modelVersion: 'v2' },
        ];
        const results = evaluateWaitEstimates(tickets, snapshots);
        expect(results.map((row) => row.predictedMs)).toEqual([60_000, 120_000]);
        expect(results[1].actualMs).toBe(3_600_000);
        expect(results[1].modelVersion).toBe('v2');
        expect(
            evaluateWaitEstimates(
                [{ ...tickets[0], firstResponseAt: at(20) }, tickets[1]],
                snapshots,
            )[1],
        ).toEqual(results[1]);
    });

    test('skips missing forecasts, invalid values, and forecasts issued after the response', () => {
        const tickets = [1, 2, 3, 4, 5].map((id) => ({
            id,
            createdAt: at(9),
            firstResponseAt: at(10),
        }));
        const snapshots = [
            { ticketId: 2, createdAt: at(11), estimatedMs: 60_000, modelVersion: 'v1' },
            { ticketId: 3, createdAt: at(8), estimatedMs: 60_000, modelVersion: 'v1' },
            { ticketId: 4, createdAt: at(9), estimatedMs: NaN, modelVersion: 'v1' },
            { ticketId: 5, createdAt: at(9), estimatedMs: 60_000, modelVersion: 'v1' },
        ];
        expect(evaluateWaitEstimates(tickets, snapshots).map((row) => row.id)).toEqual([5]);
    });

    test('counts a ticket once using its earliest valid prediction', () => {
        const tickets = [{ id: 1, createdAt: at(9), firstResponseAt: at(12) }];
        expect(
            evaluateWaitEstimates(tickets, [
                { ticketId: 1, createdAt: at(10), estimatedMs: 120_000, modelVersion: 'v2' },
                { ticketId: 1, createdAt: at(9), estimatedMs: 60_000, modelVersion: 'v1' },
            ])[0].predictedMs,
        ).toBe(60_000);
    });
});

describe('initial wait outcomes', () => {
    const base = {
        id: 1,
        createdAt: at(9),
        firstResponseAt: null,
        userId: 'requester',
        status: 'open',
    };
    test('separates pending waits from cancellations, staff closures and deletions', () => {
        expect(observeInitialWait(base, at(12))).toMatchObject({
            outcome: 'pending',
            observedMs: 3 * 3_600_000,
            endedAt: null,
        });
        expect(
            observeInitialWait(
                {
                    ...base,
                    status: 'deleted',
                    closedAt: at(10),
                    closedBy: 'requester',
                    deletedAt: at(11),
                },
                at(12),
            ),
        ).toMatchObject({
            outcome: 'requester_closed',
            observedMs: 3_600_000,
            endedAt: at(10),
            source: 'legacy',
        });
        expect(
            observeInitialWait({ ...base, closedAt: at(10), closedBy: 'staff' }, at(12)).outcome,
        ).toBe('staff_closed');
        expect(observeInitialWait({ ...base, deletedAt: at(10) }, at(12)).outcome).toBe('deleted');
        expect(observeInitialWait({ ...base, status: 'deleted' }, at(12))).toMatchObject({
            outcome: 'unknown',
            observedMs: null,
        });
    });
    test('preserves the recorded initial outcome even after a return or reopening and later reply', () => {
        const ticket = {
            ...base,
            waitOutcome: 'requester_unavailable' as const,
            waitEndedAt: at(10),
            firstResponseAt: at(11),
            firstResponseBy: 'staff',
        };
        expect(observeInitialWait(ticket, at(12))).toMatchObject({
            outcome: 'requester_unavailable',
            observedMs: 3_600_000,
            source: 'recorded',
        });
        expect(
            evaluateWaitEstimates(
                [ticket],
                [{ ticketId: 1, createdAt: at(9), estimatedMs: 1000, modelVersion: 'v3' }],
                at(12),
            ),
        ).toEqual([]);
    });
    test('respects an observation cutoff and rejects impossible or self response labels', () => {
        expect(observeInitialWait({ ...base, firstResponseAt: at(13) }, at(12)).outcome).toBe(
            'pending',
        );
        expect(
            observeInitialWait(
                { ...base, waitOutcome: 'requester_closed', waitEndedAt: at(13) },
                at(12),
            ).outcome,
        ).toBe('pending');
        expect(
            observeInitialWait(
                { ...base, firstResponseAt: at(10), firstResponseBy: 'requester' },
                at(12),
            ).outcome,
        ).toBe('invalid');
        expect(
            observeInitialWait(
                { ...base, waitOutcome: 'requester_closed', waitEndedAt: at(8) },
                at(12),
            ).outcome,
        ).toBe('invalid');
        expect(observeInitialWait({ ...base, createdAt: at(13) }, at(12)).outcome).toBe('invalid');
    });
    test('measures the remaining wait from forecast issuance and keeps seconds converted to milliseconds', () => {
        const ticket = { ...base, firstResponseAt: at(12) };
        const result = evaluateWaitEstimates(
            [ticket],
            [{ ticketId: 1, createdAt: at(10), estimatedMs: 60_000, modelVersion: 'v3' }],
            at(13),
        )[0];
        expect(result.actualMs).toBe(2 * 3_600_000);
        expect(result.errorMs).toBe(60_000 - 2 * 3_600_000);
    });
});
