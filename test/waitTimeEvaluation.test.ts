import { describe, expect, test } from 'bun:test';
import { evaluateWaitEstimates } from '../src/features/tickets/services/waitTimeEvaluation.js';

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
