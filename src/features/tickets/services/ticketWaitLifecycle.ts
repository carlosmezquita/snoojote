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

// The paired join timestamp is shared by both Gateway streams. Within one
// membership the removal is terminal, irrespective of delivery order.
export function requesterTickets(guildId: string, userId: string) {
    return and(
        eq(tickets.guildId, guildId),
        eq(tickets.userId, userId),
        inArray(tickets.status, ['creating', 'open', 'closed']),
    );
}

export function recordRequesterAvailability(
    guildId: string,
    userId: string,
    available: boolean,
    joinedAt: number | null,
    observedAt = new Date(),
    expected?: ReadonlyMap<number, number | null>,
) {
    db.transaction(
        (tx) => {
            for (const ticket of tx
                .select()
                .from(tickets)
                .where(requesterTickets(guildId, userId))
                .all()) {
                const previous = ticket.requesterMembershipSince;
                const membershipSince = joinedAt ?? previous ?? observedAt.getTime();
                if (
                    previous === null &&
                    available &&
                    ticket.requesterUnavailableAt &&
                    membershipSince <= ticket.requesterUnavailableAt.getTime()
                )
                    continue;
                if (expected && expected.get(ticket.id) !== previous) continue;
                if (previous !== null && membershipSince < previous) continue;
                if (previous === membershipSince && (available || ticket.requesterUnavailableAt))
                    continue;
                // A later membership on an existing ticket proves an intervening removal
                // even if this receiver sees the rejoin before the other receiver's leave.
                const rejoined =
                    available &&
                    (previous !== null || membershipSince >= ticket.createdAt.getTime() + 1000);
                if (!available || rejoined) {
                    preserveLegacyWaitBoundary(ticket, tx);
                    finishInitialWait(ticket.id, 'requester_unavailable', observedAt, tx);
                }
                tx.update(tickets)
                    .set({
                        requesterMembershipSince: membershipSince,
                        requesterUnavailableAt: available ? null : observedAt,
                    })
                    .where(eq(tickets.id, ticket.id))
                    .run();
            }
        },
        { behavior: 'immediate' },
    );
}
