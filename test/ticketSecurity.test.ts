import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { Collection, PermissionsBitField } from 'discord.js';
import { eq } from 'drizzle-orm';
import db from '../src/database/db.js';
import { tickets, ticketStaffActivity } from '../src/database/schema.js';
import { execute } from '../src/features/tickets/events/ticketInteraction.js';
import { ResponseTimeService } from '../src/features/tickets/services/responseTimeService.js';

const ids: number[] = [];
afterEach(() => {
    for (const id of ids.splice(0)) db.delete(tickets).where(eq(tickets.id, id)).run();
});
function ticket() {
    const row = db
        .insert(tickets)
        .values({
            channelId: randomUUID(),
            userId: 'owner',
            status: 'open',
            createdAt: new Date(Date.now() - 60_000),
        })
        .returning()
        .get();
    ids.push(row.id);
    return row;
}
describe('ticket authorization and response recording', () => {
    test('closing-modal submission rechecks permission before making a state change', async () => {
        const row = ticket();
        let denied = '';
        const interaction = {
            customId: 'close_ticket_modal',
            user: { id: 'outsider' },
            isButton: () => false,
            isModalSubmit: () => true,
            channel: { id: row.channelId, isTextBased: () => true },
            guild: {
                members: {
                    fetch: async () => ({
                        user: { bot: false },
                        permissions: new PermissionsBitField(0n),
                        roles: { cache: new Collection() },
                    }),
                },
            },
            deferReply: async () => {},
            editReply: async (message: string) => {
                denied = message;
            },
        };
        await execute(interaction as never, {} as never);
        expect(denied).toContain('No tienes permiso');
        expect(db.select().from(tickets).where(eq(tickets.id, row.id)).get()!.status).toBe('open');
    });
    test('duplicate gateway messages record activity once', async () => {
        const row = ticket();
        const service = new ResponseTimeService();
        const responseAt = new Date();
        await Promise.all(
            Array.from({ length: 20 }, () =>
                service.recordResponse(row.id, 'staff', responseAt, 'same-message'),
            ),
        );
        const activities = db
            .select()
            .from(ticketStaffActivity)
            .where(eq(ticketStaffActivity.ticketId, row.id))
            .all();
        expect(activities).toHaveLength(1);
        expect(activities[0].responseTimeMs).toBeGreaterThan(0);
        expect(db.select().from(tickets).where(eq(tickets.id, row.id)).get()!.firstResponseBy).toBe(
            'staff',
        );
    });
    test('closed tickets do not acquire a new first response', async () => {
        const row = ticket();
        db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, row.id)).run();
        await new ResponseTimeService().recordResponse(row.id, 'staff', new Date(), 'message');
        expect(
            db
                .select()
                .from(ticketStaffActivity)
                .where(eq(ticketStaffActivity.ticketId, row.id))
                .all(),
        ).toHaveLength(0);
    });
});
