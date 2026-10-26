import { and, eq, inArray, isNull } from 'drizzle-orm';
import db, { type AppDatabase } from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';

export type WaitOutcome = NonNullable<typeof tickets.$inferSelect.waitOutcome>;

// Preserve an existing closure before reopening clears its mutable fields, or
// deletion supplies a later timestamp. This cannot recover earlier lost episodes.
export function preserveLegacyWaitBoundary(
    ticket: typeof tickets.$inferSelect,
    connection: Pick<AppDatabase, 'update'>,
): void {
    if (!ticket.waitOutcome && ticket.closedAt) {
        finishInitialWait(
            ticket.id,
            ticket.closedBy == null
                ? 'closed_unknown'
                : ticket.closedBy === ticket.userId
                  ? 'requester_closed'
                  : 'staff_closed',
            ticket.closedAt,
            connection,
        );
    }
}

// Call inside the lifecycle transaction when other ticket fields change with it.
export function finishInitialWait(
    ticketId: number,
    outcome: Exclude<WaitOutcome, 'responded'>,
    at: Date,
    connection: Pick<AppDatabase, 'update'> = db,
): void {
    connection
        .update(tickets)
        .set({ waitOutcome: outcome, waitEndedAt: at })
        .where(
            and(
                eq(tickets.id, ticketId),
                isNull(tickets.waitOutcome),
                isNull(tickets.firstResponseAt),
            ),
        )
        .run();
}

// A removal event means leave/kick/ban, not necessarily voluntary abandonment.
// The timestamp is when the bot observed the event; no historical date is invented.
export function recordRequesterAvailability(
    guildId: string,
    userId: string,
    available: boolean,
): void {
    const now = new Date();
    db.transaction(
        (tx) => {
            const active = tx
                .select()
                .from(tickets)
                .where(
                    and(
                        eq(tickets.guildId, guildId),
                        eq(tickets.userId, userId),
                        inArray(tickets.status, ['creating', 'open', 'closed']),
                    ),
                )
                .all();
            for (const ticket of active) {
                tx.update(tickets)
                    .set({ requesterUnavailableAt: available ? null : now })
                    .where(
                        and(
                            eq(tickets.id, ticket.id),
                            available ? undefined : isNull(tickets.requesterUnavailableAt),
                        ),
                    )
                    .run();
                if (!available) {
                    preserveLegacyWaitBoundary(ticket, tx);
                    finishInitialWait(ticket.id, 'requester_unavailable', now, tx);
                }
            }
        },
        { behavior: 'immediate' },
    );
}
