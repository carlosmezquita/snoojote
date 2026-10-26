import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import db from '../src/database/db.js';
import { tickets, ticketWaitEstimateSnapshots } from '../src/database/schema.js';
import { formatWaitObservationsCsv } from '../src/features/tickets/services/waitTimeExport.js';

const ids: number[] = [];
afterEach(() => {
    for (const id of ids.splice(0)) db.delete(tickets).where(eq(tickets.id, id)).run();
});
const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
function ticket() {
    const row = db
        .insert(tickets)
        .values({ channelId: randomUUID(), userId: 'private-owner', createdAt: at(0) })
        .returning()
        .get();
    ids.push(row.id);
    return row;
}

describe('wait observation export', () => {
    test('includes tickets without forecasts and distinguishes a missing response from zero seconds', () => {
        const pending = ticket();
        const csv = formatWaitObservationsCsv([pending], [], at(60));
        const lines = csv.trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('"pending","legacy","","60000","",""');
        expect(csv).not.toContain('private-owner');
    });
    test('exports true milliseconds, raw timestamps, every snapshot, and CSV escaped JSON', () => {
        const answered = { ...ticket(), firstResponseAt: at(55), firstResponseBy: 'private-staff' };
        const snapshot = db
            .insert(ticketWaitEstimateSnapshots)
            .values({
                ticketId: answered.id,
                modelVersion: 'v3',
                estimatedMs: 60_000,
                createdAt: at(1),
                factorDetails: { note: 'a "quoted", value' },
            })
            .returning()
            .get();
        const csv = formatWaitObservationsCsv(
            [answered],
            [snapshot, { ...snapshot, id: snapshot.id + 1, createdAt: at(56) }],
            at(60),
        );
        const lines = csv.trim().split('\n');
        expect(lines).toHaveLength(3);
        expect(lines[1]).toContain(
            '"responded","legacy","2026-01-01T00:00:55.000Z","55000","55000"',
        );
        expect(lines[1]).toContain('"true"');
        expect(lines[2]).toContain('"false"');
        expect(csv).toContain('"{""note"":""a \\""quoted\\"", value""}"');
        expect(csv).not.toContain('private-staff');
    });
});
