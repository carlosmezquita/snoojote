import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import {
    Collection,
    EmbedBuilder,
    PermissionFlagsBits,
    PermissionsBitField,
    type AttachmentBuilder,
    type Guild,
    type TextChannel,
    type User,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import db from '../src/database/db.js';
import { tickets } from '../src/database/schema.js';
import { config } from '../src/config.js';
import { TicketService } from '../src/features/tickets/services/ticketService.js';
import { type TicketOptionConfig } from '../src/features/tickets/config/TicketConfig.js';
import { estimateWaitTime } from '../src/features/tickets/services/waitTimeEstimator.js';
import { ResponseTimeService } from '../src/features/tickets/services/responseTimeService.js';
import {
    type AttachmentFetcher,
    type TicketAttachment,
} from '../src/features/tickets/services/ticketAttachments.js';

const screenshotBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
    'base64',
);
const screenshot: TicketAttachment = {
    id: '123',
    name: 'proof.png',
    contentType: 'image/png',
    spoiler: false,
    size: screenshotBytes.length,
    url: 'https://cdn.discordapp.com/attachments/100/123/proof.png',
};
type SentMessage = {
    content: string;
    files?: AttachmentBuilder[];
    embeds?: EmbedBuilder[];
    allowedMentions?: { parse: string[] };
};

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
    const sent: SentMessage[] = [];
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
                    send: async (message: SentMessage) => {
                        sent.push(message);
                    },
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
    const service = (fetcher?: AttachmentFetcher) =>
        new TicketService(
            responses as unknown as NonNullable<ConstructorParameters<typeof TicketService>[0]>,
            fetcher,
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
        sent,
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
    test('sends screenshots in a separate private message after the opening embed', async () => {
        const f = fixture();
        const channel = await f
            .service(async () => new Response(screenshotBytes))
            .createTicket(
                f.user,
                f.guild,
                f.option,
                [{ question: 'Details', answer: 'Spam evidence' }],
                [screenshot],
            );
        expect(channel).not.toBeNull();
        expect(f.sent).toHaveLength(2);
        expect(f.sent[0].files).toBeUndefined();
        expect(f.sent[0].embeds?.[0].data.description).toContain('Spam evidence');
        expect(f.sent[1].files?.[0].attachment).toEqual(screenshotBytes);
        expect(f.sent[1].embeds).toBeUndefined();
        expect(f.sent[1].content).toContain('Capturas de pantalla');
        expect(f.sent[1].allowedMentions).toEqual({ parse: [] });
        expect(
            f.channels[0].permissionOverwrites.find(
                (overwrite: { id: string }) => overwrite.id === 'bot',
            ).allow,
        ).toContain(PermissionFlagsBits.AttachFiles);
        expect(
            f.channels[0].permissionOverwrites.find(
                (overwrite: { id: string }) => overwrite.id === f.guild.id,
            ).deny,
        ).toContain(PermissionFlagsBits.ViewChannel);
        expect(f.rows()[0].status).toBe('open');
    });

    test('download failure releases the reservation without opening an empty ticket', async () => {
        const f = fixture();
        await expect(
            f
                .service(async () => new Response(null, { status: 404 }))
                .createTicket(f.user, f.guild, f.option, [], [screenshot]),
        ).rejects.toThrow('descargar');
        expect(f.channels).toHaveLength(0);
        expect(f.rows()).toHaveLength(0);
        expect(await f.service().createTicket(f.user, f.guild, f.option, [])).not.toBeNull();
        expect(f.sent).toHaveLength(1);
        expect(f.sent[0].files).toBeUndefined();
    });

    test('a failed screenshot send rolls back the channel and never records an ETA', async () => {
        const f = fixture();
        let snapshots = 0;
        f.responses.recordEstimateSnapshot = async () => {
            snapshots++;
        };
        f.responses.getStaffCapacity = async () => {
            f.channels[0].send = async (message: SentMessage) => {
                if (message.files?.length) throw new Error('Upload rejected');
                f.sent.push(message);
            };
            return { activeCount: 1, weightedCapacity: 1 };
        };
        await expect(
            f
                .service(async () => new Response(screenshotBytes))
                .createTicket(f.user, f.guild, f.option, [], [screenshot]),
        ).rejects.toThrow('Upload rejected');
        expect(f.sent).toHaveLength(1);
        expect(f.sent[0].embeds).toHaveLength(1);
        expect(snapshots).toBe(0);
        expect(f.channels[0].deleted).toBe(true);
        expect(f.rows()).toHaveLength(0);
    });

    test('does not announce or save a new ETA when staff already replied during initialization', async () => {
        const f = fixture();
        let snapshots = 0;
        let welcomeText = '';
        f.responses.recordEstimateSnapshot = async () => {
            snapshots++;
        };
        f.responses.getStaffCapacity = async () => {
            await new ResponseTimeService().recordResponse(
                f.rows()[0].id,
                'staff',
                new Date(),
                'early-staff-message',
            );
            f.channels[0].send = async (message: { embeds: EmbedBuilder[] }) => {
                welcomeText = message.embeds[0].data.description ?? '';
            };
            return { activeCount: 1, weightedCapacity: 1 };
        };
        await f
            .service()
            .createTicket(f.user, f.guild, f.option, [
                { question: 'Reason', answer: 'Keep the form answer' },
            ]);
        expect(snapshots).toBe(0);
        expect(welcomeText).not.toContain('Estimación orientativa');
        expect(welcomeText).toContain('Keep the form answer');
    });
    test('simultaneous tickets include other pending creations in each queue snapshot', async () => {
        const f = fixture();
        const responseTimes = new ResponseTimeService();
        const service = new TicketService({
            ...f.responses,
            getOpenTicketCount: responseTimes.getOpenTicketCount.bind(responseTimes),
            getUnansweredQueueLength: responseTimes.getUnansweredQueueLength.bind(responseTimes),
        } as never);
        const users = Array.from({ length: 5 }, () => ({ ...f.user, id: randomUUID() }) as User);
        userIds.push(...users.map((user) => user.id));
        await Promise.all(users.map((user) => service.createTicket(user, f.guild, f.option, [])));
        const rows = db
            .select()
            .from(tickets)
            .all()
            .filter((row) => users.some((user) => user.id === row.userId));
        expect(rows).toHaveLength(5);
        expect(rows.map((row) => row.unansweredTicketsAtCreation)).toEqual([4, 4, 4, 4, 4]);
    });
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
    test('preserves opening form answers, announced estimates, and stable message identity', async () => {
        const opening = {
            id: 'message-1',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            author: { id: 'bot-id', tag: 'bot', bot: true },
            content: '<@requester>',
            attachments: new Collection(),
            embeds: [
                new EmbedBuilder()
                    .setTitle('Support request')
                    .setDescription('Estimate: 15 minutes\nReason: my test question')
                    .addFields({ name: 'Details', value: 'line one\nline two' }),
            ],
        };
        const channel = {
            name: 'ticket',
            messages: { fetch: async () => new Collection([[opening.id, opening]]) },
        } as unknown as TextChannel;
        const transcript = await new TicketService().generateTranscript(channel);
        expect(transcript).toContain('my test question');
        expect(transcript).toContain('Estimate: 15 minutes');
        expect(transcript).toContain('line one\\nline two');
        expect(transcript).toContain('"messageId":"message-1","authorId":"bot-id","bot":true');
    });
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
        let publicArchive = false;
        let archiveGuildId = f.guild.id;
        let failFinalTranscript = false;
        const archiveMessages: SentMessage[] = [];
        const channel = {
            id,
            name: 'ticket',
            guild: { id: f.guild.id, name: 'guild' },
            messages: { fetch: async () => new Collection() },
            client: {
                user: { id: 'bot' },
                channels: {
                    fetch: async () =>
                        archiveAvailable
                            ? {
                                  id: 'archive-channel',
                                  guildId: archiveGuildId,
                                  permissionsFor: () =>
                                      new PermissionsBitField(
                                          publicArchive ? PermissionFlagsBits.ViewChannel : 0n,
                                      ),
                                  isTextBased: () => true,
                                  send: async (message: SentMessage) => {
                                      if (failFinalTranscript && message.content.startsWith('📄'))
                                          throw new Error('Transcript send failed');
                                      archives++;
                                      archiveMessages.push(message);
                                      await new Promise(setImmediate);
                                      return {
                                          url: `https://discord.com/channels/${f.guild.id}/archive-channel/${archives}`,
                                          attachments: new Collection([
                                              [
                                                  'copy',
                                                  {
                                                      id: `copy-${archives}`,
                                                      name: message.files?.[0].name,
                                                  },
                                              ],
                                          ]),
                                      };
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
            archiveMessages,
            publicArchive: () => {
                publicArchive = true;
            },
            otherGuild: () => {
                archiveGuildId = 'another-guild';
            },
            failFinalArchive: () => {
                failFinalTranscript = true;
            },
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

    function addEvidence(channel: TextChannel, evidence: TicketAttachment[] = [screenshot]) {
        channel.messages.fetch = (async () =>
            new Collection([
                [
                    'report',
                    {
                        id: 'report',
                        createdAt: new Date(),
                        author: { id: 'reporter', tag: 'reporter', bot: false },
                        content: 'Evidence',
                        attachments: new Collection(evidence.map((a) => [a.id, a])),
                        embeds: [],
                    },
                ],
            ])) as never;
    }

    test('copies actual evidence before deleting, with retrievable message references in the transcript', async () => {
        const f = lifecycleFixture();
        addEvidence(f.channel);
        await f.service(async () => new Response(screenshotBytes)).deleteTicket(f.channel, f.user);
        expect(f.archiveMessages).toHaveLength(2);
        expect(f.archiveMessages[0].files?.[0].attachment).toEqual(screenshotBytes);
        expect(f.archiveMessages[0].allowedMentions).toEqual({ parse: [] });
        const text = (f.archiveMessages[1].files![0].attachment as Buffer).toString();
        expect(text).toContain('"sourceMessageId":"report"');
        expect(text).toContain('"sourceAttachmentId":"123"');
        expect(text).toContain('"archiveMessageUrl":"https://discord.com/channels/');
        expect(text).toContain('"archiveAttachmentId":"copy-1"');
        expect(f.deletes()).toBe(1);
        expect(f.rows()[0].status).toBe('deleted');
    });

    test('failed evidence download preserves the open ticket for close and delete retries', async () => {
        const f = lifecycleFixture();
        addEvidence(f.channel);
        const service = f.service(async () => new Response(null, { status: 404 }));
        await expect(service.closeTicket(f.channel, f.user)).rejects.toThrow('descargar');
        await expect(service.deleteTicket(f.channel, f.user)).rejects.toThrow('descargar');
        expect(f.archives()).toBe(0);
        expect(f.rows()[0].status).toBe('open');
        expect(f.deletes()).toBe(0);
    });

    test('a failed final transcript after evidence copying still prevents ticket deletion', async () => {
        const f = lifecycleFixture();
        addEvidence(f.channel);
        f.failFinalArchive();
        await expect(
            f.service(async () => new Response(screenshotBytes)).deleteTicket(f.channel, f.user),
        ).rejects.toThrow('Transcript send failed');
        expect(f.archives()).toBe(1);
        expect(f.rows()[0].status).toBe('open');
        expect(f.deletes()).toBe(0);
    });

    test('rejects public and cross-guild archive destinations before copying any evidence', async () => {
        for (const publicDestination of [true, false]) {
            const f = lifecycleFixture();
            addEvidence(f.channel);
            if (publicDestination) f.publicArchive();
            else f.otherGuild();
            let downloads = 0;
            await expect(
                f
                    .service(async () => {
                        downloads++;
                        return new Response(screenshotBytes);
                    })
                    .deleteTicket(f.channel, f.user),
            ).rejects.toThrow('privado');
            expect(downloads).toBe(0);
            expect(f.archives()).toBe(0);
            expect(f.deletes()).toBe(0);
            expect(f.rows()[0].status).toBe('open');
        }
    });

    test('archive attachment budgets reject before downloads or destructive side effects', async () => {
        for (const evidence of [
            Array.from({ length: 21 }, (_, i) => ({ ...screenshot, id: String(i) })),
            Array.from({ length: 5 }, (_, i) => ({
                ...screenshot,
                id: String(i),
                size: 8 * 1024 * 1024,
            })),
        ]) {
            const f = lifecycleFixture();
            addEvidence(f.channel, evidence);
            let downloads = 0;
            await expect(
                f
                    .service(async () => {
                        downloads++;
                        return new Response(screenshotBytes);
                    })
                    .deleteTicket(f.channel, f.user),
            ).rejects.toThrow('límite de archivo');
            expect(downloads).toBe(0);
            expect(f.archives()).toBe(0);
            expect(f.deletes()).toBe(0);
        }
    });

    test('a prior bot-generated close transcript does not consume the evidence budget on deletion', async () => {
        const f = lifecycleFixture();
        const evidence = Array.from({ length: 20 }, (_, i) => ({ ...screenshot, id: String(i) }));
        addEvidence(f.channel, evidence);
        const messages = await f.channel.messages.fetch({ limit: 100 });
        messages.set('closed', {
            id: 'closed',
            createdAt: new Date(),
            author: { id: 'bot', tag: 'bot', bot: true },
            content: 'Ticket closed',
            attachments: new Collection([
                [
                    'previous-transcript',
                    {
                        ...screenshot,
                        id: 'previous-transcript',
                        name: 'transcript-ticket.txt',
                    },
                ],
            ]),
            embeds: [],
        } as never);
        f.channel.messages.fetch = (async () => messages) as never;
        await f.service(async () => new Response(screenshotBytes)).deleteTicket(f.channel, f.user);
        expect(f.archiveMessages).toHaveLength(21);
        expect(f.deletes()).toBe(1);
    });

    test('concurrent close requests across instances archive and close once', async () => {
        const f = lifecycleFixture();
        await Promise.all(
            Array.from({ length: 20 }, () => f.service().closeTicket(f.channel, f.user)),
        );
        expect(f.archives()).toBe(1);
        expect(f.rows()[0].status).toBe('closed');
        expect(f.rows()[0].waitOutcome).toBe('requester_closed');
        expect(f.rows()[0].waitEndedAt).toEqual(f.rows()[0].closedAt);
    });

    test('reopening cannot relabel a cancelled initial wait as an answered ticket', async () => {
        const f = lifecycleFixture();
        await f.service().closeTicket(f.channel, f.user);
        const endedAt = f.rows()[0].waitEndedAt;
        await f.service().reopenTicket(f.channel, f.user);
        await new ResponseTimeService().recordResponse(
            f.rows()[0].id,
            'staff',
            new Date(),
            'late-reply',
        );
        expect(f.rows()[0].status).toBe('open');
        expect(f.rows()[0].firstResponseBy).toBe('staff');
        expect(f.rows()[0].waitOutcome).toBe('requester_closed');
        expect(f.rows()[0].waitEndedAt).toEqual(endedAt);
    });

    test('records staff closures and direct deletions without inventing responses', async () => {
        const closed = lifecycleFixture();
        await closed.service().closeTicket(closed.channel, {
            id: 'staff',
            toString: () => 'staff',
        } as unknown as User);
        expect(closed.rows()[0].waitOutcome).toBe('staff_closed');
        const deleted = lifecycleFixture();
        await deleted.service().deleteTicket(deleted.channel, deleted.user);
        expect(deleted.rows()[0].waitOutcome).toBe('deleted');
        expect(deleted.rows()[0].waitEndedAt).toEqual(deleted.rows()[0].deletedAt);
        expect(deleted.rows()[0].firstResponseAt).toBeNull();
    });

    test('retains known legacy closure boundaries through reopen and deletion', async () => {
        for (const reopen of [true, false]) {
            const f = lifecycleFixture();
            const closedAt = new Date(Date.now() - 60_000);
            db.update(tickets)
                .set({
                    status: 'closed',
                    createdAt: new Date(closedAt.getTime() - 60_000),
                    closedAt,
                    closedBy: f.user.id,
                })
                .where(eq(tickets.channelId, f.channel.id))
                .run();
            const boundary = f.rows()[0].closedAt;
            if (reopen) await f.service().reopenTicket(f.channel, f.user);
            else await f.service().deleteTicket(f.channel, f.user);
            expect(f.rows()[0].waitOutcome).toBe('requester_closed');
            expect(f.rows()[0].waitEndedAt).toEqual(boundary);
        }
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
        expect(f.rows()[0].waitOutcome).toBeNull();
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
