import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { Collection, PermissionsBitField } from 'discord.js';
import { eq } from 'drizzle-orm';
import db, { sqlite } from '../src/database/db.js';
import { tickets, ticketStaffActivity } from '../src/database/schema.js';
import { execute } from '../src/features/tickets/events/ticketInteraction.js';
import { ResponseTimeService } from '../src/features/tickets/services/responseTimeService.js';
import { execute as requesterLeave } from '../src/features/tickets/events/requesterLeave.js';
import { execute as requesterJoin } from '../src/features/tickets/events/requesterJoin.js';
import messageCreate from '../src/features/tickets/events/messageCreate.js';

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
            guildId: randomUUID(),
            status: 'open',
            createdAt: new Date(Date.now() - 60_000),
        })
        .returning()
        .get();
    ids.push(row.id);
    return row;
}
describe('ticket authorization and response recording', () => {
    test('uses an isolated in-memory database', () => {
        const databases = sqlite
            .query<{ name: string; file: string }, []>('PRAGMA database_list')
            .all();
        expect(databases.find((entry) => entry.name === 'main')?.file).toBe('');
    });

    test('staff opening their own ticket cannot supply their own first response', async () => {
        const row = ticket();
        const service = new ResponseTimeService();
        await service.recordResponse(row.id, row.userId, new Date(), 'owner-message');
        await service.recordResponse(
            row.id,
            'staff',
            new Date(row.createdAt.getTime() - 1000),
            'old-message',
        );
        expect(
            db.select().from(tickets).where(eq(tickets.id, row.id)).get()!.firstResponseAt,
        ).toBeNull();
        expect(
            db
                .select()
                .from(ticketStaffActivity)
                .where(eq(ticketStaffActivity.ticketId, row.id))
                .all(),
        ).toHaveLength(0);
    });

    test('gateway replies are tracked while a visible channel is still being initialized', async () => {
        const row = ticket();
        db.update(tickets).set({ status: 'creating' }).where(eq(tickets.id, row.id)).run();
        await messageCreate.execute(
            {
                id: 'early-message',
                createdAt: new Date(),
                channel: { id: row.channelId },
                guild: { id: row.guildId },
                author: { id: 'staff', bot: false },
                member: {
                    user: { bot: false },
                    permissions: new PermissionsBitField(8n),
                    roles: { cache: new Collection() },
                },
            } as never,
            {
                logger: {
                    error: () => {
                        throw new Error('Unexpected handler error');
                    },
                },
            } as never,
        );
        const saved = db.select().from(tickets).where(eq(tickets.id, row.id)).get()!;
        expect(saved.firstResponseBy).toBe('staff');
        expect(saved.waitOutcome).toBe('responded');
        expect(saved.waitEndedAt).toEqual(saved.firstResponseAt);
    });

    test('a member removal ends the initial wait without assuming a voluntary leave; return preserves that outcome', async () => {
        const row = ticket();
        const other = ticket();
        const service = new ResponseTimeService();
        requesterLeave({ id: row.userId, guild: { id: row.guildId } } as never);
        const departed = db.select().from(tickets).where(eq(tickets.id, row.id)).get()!;
        expect(departed.waitOutcome).toBe('requester_unavailable');
        expect(departed.waitEndedAt).not.toBeNull();
        expect(await service.getUnansweredQueueLength(row.guildId!)).toBe(0);
        expect(await service.getUnansweredQueueLength(other.guildId!)).toBe(1);
        await service.recordResponse(row.id, 'staff', new Date(), 'after-removal');
        expect(
            db.select().from(tickets).where(eq(tickets.id, row.id)).get()!.firstResponseAt,
        ).toBeNull();
        requesterJoin({ id: row.userId, guild: { id: row.guildId } } as never);
        expect(await service.getUnansweredQueueLength(row.guildId!)).toBe(1);
        await service.recordResponse(row.id, 'staff', new Date(), 'after-return');
        const returned = db.select().from(tickets).where(eq(tickets.id, row.id)).get()!;
        expect(returned.requesterUnavailableAt).toBeNull();
        expect(returned.waitOutcome).toBe('requester_unavailable');
        expect(returned.waitEndedAt).toEqual(departed.waitEndedAt);
        expect(returned.firstResponseBy).toBe('staff');
        expect(await service.getUnansweredQueueLength(row.guildId!)).toBe(0);
        expect(
            db
                .select()
                .from(ticketStaffActivity)
                .where(eq(ticketStaffActivity.ticketId, row.id))
                .get()!.responseTimeMs,
        ).toBeNull();
    });

    test('pending reservations count in the queue, excluding the ticket being forecast', async () => {
        const row = ticket();
        const reserved = ticket();
        db.update(tickets)
            .set({ guildId: row.guildId, status: 'creating', channelId: 'pending:reservation' })
            .where(eq(tickets.id, reserved.id))
            .run();
        const service = new ResponseTimeService();
        expect(await service.getUnansweredQueueLength(row.guildId!)).toBe(2);
        expect(await service.getUnansweredQueueLength(row.guildId!, row.id)).toBe(1);
        await service.recordResponse(reserved.id, 'staff', new Date(), 'no-channel-yet');
        expect(
            db.select().from(tickets).where(eq(tickets.id, reserved.id)).get()!.firstResponseAt,
        ).toBeNull();
    });

    test('historical baselines exclude owner replies and replies after a cancelled initial wait', async () => {
        const valid = ticket();
        const self = ticket();
        const cancelled = ticket();
        const responseAt = new Date(valid.createdAt.getTime() + 30_000);
        db.update(tickets)
            .set({ firstResponseAt: responseAt, firstResponseBy: 'staff' })
            .where(eq(tickets.id, valid.id))
            .run();
        db.update(tickets)
            .set({
                firstResponseAt: new Date(self.createdAt.getTime() + 1000),
                firstResponseBy: self.userId,
            })
            .where(eq(tickets.id, self.id))
            .run();
        db.update(tickets)
            .set({
                firstResponseAt: new Date(cancelled.createdAt.getTime() + 1000),
                firstResponseBy: 'staff',
                waitOutcome: 'requester_closed',
                waitEndedAt: cancelled.createdAt,
            })
            .where(eq(tickets.id, cancelled.id))
            .run();
        const guild = {
            id: randomUUID(),
            roles: { cache: new Collection() },
            members: { cache: new Collection(), fetch: async () => new Collection() },
        };
        const estimate = await new ResponseTimeService().createEstimate(guild as never);
        expect(estimate.factors.globalMedianMs).toBe(30_000);
        expect(estimate.factors.recentMedianMs).toBe(30_000);
    });
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
