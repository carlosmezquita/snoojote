import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { Collection, type Guild, type TextChannel, type User } from 'discord.js';
import { eq } from 'drizzle-orm';
import db from '../src/database/db.js';
import { tickets } from '../src/database/schema.js';
import { config } from '../src/config.js';
import { TicketService } from '../src/features/tickets/services/ticketService.js';
import { type TicketOptionConfig } from '../src/features/tickets/config/TicketConfig.js';
import { estimateWaitTime } from '../src/features/tickets/services/waitTimeEstimator.js';

const userIds: string[] = [];
const originalLimit = config.tickets.maxOpenPerUser;
afterEach(() => {
    config.tickets.maxOpenPerUser = originalLimit;
    for (const id of userIds.splice(0)) db.delete(tickets).where(eq(tickets.userId, id)).run();
});

function fixture() {
    config.tickets.maxOpenPerUser = 1;
    const user = {
        id: randomUUID(),
        username: 'test',
        toString: () => '<@test>',
    } as unknown as User;
    userIds.push(user.id);
    const channels: any[] = [];
    let failDelete = false;
    let loseCreateResponse = false;
    const guild = {
        id: randomUUID(),
        client: { user: { id: 'bot' } },
        channels: {
            create: async (data: any) => {
                const channel = {
                    ...data,
                    id: randomUUID(),
                    deleted: false,
                    send: async () => {},
                    delete: async () => {
                        if (failDelete) throw new Error('Missing delete permission');
                        channel.deleted = true;
                    },
                };
                channels.push(channel);
                if (loseCreateResponse) throw new Error('Create response lost');
                return channel;
            },
            fetch: async () =>
                new Collection(channels.filter((c) => !c.deleted).map((c) => [c.id, c])),
        },
    } as unknown as Guild;
    const responses = {
        getStaffCapacity: async () => ({ activeCount: 1, weightedCapacity: 1 }),
        getOpenTicketCount: async () => 0,
        getUnansweredQueueLength: async () => 0,
        createEstimate: async () =>
            estimateWaitTime({
                recentTickets: [],
                temporalTickets: [],
                allTickets: [],
                now: new Date(),
                queueLength: 0,
                activeStaff: 1,
            }),
        recordEstimateSnapshot: async () => {},
    };
    const service = () =>
        new TicketService(
            responses as unknown as NonNullable<ConstructorParameters<typeof TicketService>[0]>,
        );
    const option = {
        id: 'general',
        channelPrefix: 'ticket-',
        adminRoles: [],
        categoryId: '',
        ticketWelcomeMessage: 'Welcome',
        enableDmOnOpen: false,
    } as unknown as TicketOptionConfig;
    const rows = () => db.select().from(tickets).where(eq(tickets.userId, user.id)).all();
    return {
        user,
        guild,
        option,
        responses,
        service,
        channels,
        rows,
        failDeletion: (value: boolean) => {
            failDelete = value;
        },
        loseResponse: () => {
            loseCreateResponse = true;
        },
    };
}

describe('ticket creation reservations and rollback', () => {
    test('reopening cannot bypass capacity occupied by another open ticket', async () => {
        const f = fixture();
        await f.service().createTicket(f.user, f.guild, f.option, []);
        db.insert(tickets)
            .values({ userId: f.user.id, channelId: 'closed-ticket', status: 'closed' })
            .run();
        await expect(
            f.service().reopenTicket({ id: 'closed-ticket' } as TextChannel, f.user),
        ).rejects.toThrow('Open ticket limit reached');
        expect(f.rows().filter((row) => row.status === 'open')).toHaveLength(1);
    });

    test('concurrent requests across service instances share the open-ticket limit', async () => {
        const f = fixture();
        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                f.service().createTicket(f.user, f.guild, f.option, []),
            ),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(f.channels).toHaveLength(1);
        expect(f.rows()).toHaveLength(1);
        expect(f.rows()[0].status).toBe('open');
        expect(f.rows()[0].unansweredTicketsAtCreation).toBe(0);
    });

    test('failure after channel creation deletes the channel and releases the slot', async () => {
        const f = fixture();
        f.responses.createEstimate = async () => {
            throw new Error('Estimate failed');
        };
        await expect(f.service().createTicket(f.user, f.guild, f.option, [])).rejects.toThrow(
            'Estimate failed',
        );
        expect(f.channels[0].deleted).toBe(true);
        expect(f.rows()).toHaveLength(0);
    });

    test('finds and removes a channel even when its create response was lost', async () => {
        const f = fixture();
        f.loseResponse();
        await expect(f.service().createTicket(f.user, f.guild, f.option, [])).rejects.toThrow(
            'Create response lost',
        );
        expect(f.channels[0].deleted).toBe(true);
        expect(f.rows()).toHaveLength(0);
    });

    test('failed deletion preserves recovery state and blocks another creation', async () => {
        const f = fixture();
        f.responses.createEstimate = async () => {
            throw new Error('Estimate failed');
        };
        f.failDeletion(true);
        await expect(f.service().createTicket(f.user, f.guild, f.option, [])).rejects.toThrow();
        expect(f.rows()[0].status).toBe('creation_failed');
        expect(await f.service().createTicket(f.user, f.guild, f.option, [])).toBeNull();
        f.failDeletion(false);
        await f.service().recoverIncompleteTickets(f.guild);
        expect(f.rows()).toHaveLength(0);
        expect(f.channels[0].deleted).toBe(true);
    });

    test('startup recovery locates a channel by its durable reservation marker', async () => {
        const f = fixture();
        const row = db
            .insert(tickets)
            .values({
                userId: f.user.id,
                guildId: f.guild.id,
                channelId: 'pending:lost',
                status: 'creating',
            })
            .returning()
            .get();
        f.channels.push({
            id: 'discord-channel',
            topic: `snoojote-ticket:${row.id}`,
            delete: async () => {
                f.channels[0].deleted = true;
            },
        });
        await f.service().recoverIncompleteTickets(f.guild);
        expect(f.channels[0].deleted).toBe(true);
        expect(f.rows()).toHaveLength(0);
    });

    test('concurrent staff claims cannot overwrite the winner', async () => {
        const f = fixture();
        await f.service().createTicket(f.user, f.guild, f.option, []);
        const channel = f.channels[0] as TextChannel;
        const claimers = ['alice', 'bob'].map((id) => ({ id, toString: () => id }) as User);
        const results = await Promise.all(
            claimers.map((user) => f.service().claimTicket(channel, user)),
        );
        expect(results.filter((result) => result.success)).toHaveLength(1);
        expect(f.rows()[0].claimedBy).toBe('alice');
    });
});

describe('complete ticket transcripts', () => {
    test('paginates all messages in chronological order, including attachments', async () => {
        const records = Array.from({ length: 250 }, (_, index) => ({
            id: String(index + 1),
            createdAt: new Date(index * 1000),
            author: { tag: 'user' },
            content: `message-${index + 1}`,
            attachments: new Collection(
                index === 0 ? [['attachment', { url: 'https://example.com/file' }]] : [],
            ),
        }));
        let calls = 0;
        const channel = {
            name: 'ticket',
            messages: {
                fetch: async ({ before }: { before?: string }) => {
                    calls++;
                    const start = before ? Number(before) - 1 : records.length;
                    const page = records.slice(Math.max(0, start - 100), start).reverse();
                    return new Collection(page.map((message) => [message.id, message]));
                },
            },
        } as unknown as TextChannel;
        const transcript = await new TicketService().generateTranscript(channel);
        expect(calls).toBe(3);
        expect(transcript.match(/: message-/g)).toHaveLength(250);
        expect(transcript.indexOf(': message-1\n')).toBeLessThan(
            transcript.indexOf(': message-250\n'),
        );
        expect(transcript).toContain('[Attachments]: https://example.com/file');
    });

    test('fetch failure rejects instead of returning an incomplete archive', async () => {
        const channel = {
            name: 'ticket',
            messages: {
                fetch: async () => {
                    throw new Error('Rate limited');
                },
            },
        } as unknown as TextChannel;
        await expect(new TicketService().generateTranscript(channel)).rejects.toThrow(
            'Rate limited',
        );
    });
});

describe('ticket lifecycle safety', () => {
    function lifecycleFixture() {
        const f = fixture();
        const id = randomUUID();
        db.insert(tickets).values({ userId: f.user.id, channelId: id, status: 'open' }).run();
        let archives = 0;
        let deletes = 0;
        let archiveAvailable = true;
        let deletionFails = false;
        let permissionFails = false;
        const channel = {
            id,
            name: 'ticket',
            guild: { name: 'guild' },
            messages: { fetch: async () => new Collection() },
            client: {
                channels: {
                    fetch: async () =>
                        archiveAvailable
                            ? {
                                  isTextBased: () => true,
                                  send: async () => {
                                      archives++;
                                      await new Promise(setImmediate);
                                  },
                              }
                            : null,
                },
                users: { fetch: async () => null },
            },
            permissionOverwrites: {
                edit: async () => {
                    if (permissionFails) throw new Error('Missing overwrite permission');
                },
            },
            send: async () => {},
            delete: async () => {
                if (deletionFails) throw new Error('Missing permissions');
                deletes++;
            },
        } as unknown as TextChannel;
        return {
            ...f,
            channel,
            archives: () => archives,
            deletes: () => deletes,
            unavailable: () => {
                archiveAvailable = false;
            },
            failPermission: () => {
                permissionFails = true;
            },
            failDelete: () => {
                deletionFails = true;
            },
        };
    }

    test('concurrent close requests across instances archive and close once', async () => {
        const f = lifecycleFixture();
        await Promise.all(
            Array.from({ length: 20 }, () => f.service().closeTicket(f.channel, f.user)),
        );
        expect(f.archives()).toBe(1);
        expect(f.rows()[0].status).toBe('closed');
    });

    test('an unavailable archive preserves the ticket for close and delete retries', async () => {
        const f = lifecycleFixture();
        f.unavailable();
        await expect(f.service().closeTicket(f.channel, f.user)).rejects.toThrow('preserved');
        await expect(f.service().deleteTicket(f.channel, f.user)).rejects.toThrow('preserved');
        expect(f.rows()[0].status).toBe('open');
        expect(f.deletes()).toBe(0);
    });

    test('Discord deletion failure leaves a retryable record', async () => {
        const f = lifecycleFixture();
        f.failDelete();
        await expect(f.service().deleteTicket(f.channel, f.user)).rejects.toThrow(
            'Missing permissions',
        );
        expect(f.rows()[0].status).toBe('open');
        expect(f.rows()[0].deletedAt).toBeNull();
        expect(f.archives()).toBe(1);
    });

    test('failed channel permission changes do not report a completed close or reopen', async () => {
        const f = lifecycleFixture();
        f.failPermission();
        await expect(f.service().closeTicket(f.channel, f.user)).rejects.toThrow(
            'Missing overwrite',
        );
        expect(f.rows()[0].status).toBe('open');
        db.update(tickets)
            .set({ status: 'closed' })
            .where(eq(tickets.channelId, f.channel.id))
            .run();
        await expect(f.service().reopenTicket(f.channel, f.user)).rejects.toThrow(
            'Missing overwrite',
        );
        expect(f.rows()[0].status).toBe('closed');
    });

    test('oversized transcripts fail without silently truncating content', async () => {
        let fetches = 0;
        const channel = {
            name: 'huge-ticket',
            messages: {
                fetch: async () => {
                    fetches++;
                    return new Collection(
                        Array.from({ length: 100 }, (_, i) => [
                            String(i),
                            {
                                id: String(i),
                                createdAt: new Date(),
                                author: { tag: 'user' },
                                content: 'x'.repeat(100_000),
                                attachments: new Collection(),
                            },
                        ]),
                    );
                },
            },
        } as unknown as TextChannel;
        await expect(new TicketService().generateTranscript(channel)).rejects.toThrow('8 MiB');
        expect(fetches).toBe(1);
    });
});
