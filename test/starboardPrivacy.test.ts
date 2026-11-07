import { afterEach, describe, expect, test } from 'bun:test';
import { Collection, PermissionsBitField, PermissionFlagsBits, ChannelType } from 'discord.js';
import { eq } from 'drizzle-orm';
import db, { sqlite } from '../src/database/db.js';
import { starboardMessages } from '../src/database/schema.js';
import { config } from '../src/config.js';
import { StarboardService } from '../src/features/starboard/services/StarboardService.js';

const ids: string[] = [];
afterEach(() => {
    for (const id of ids.splice(0))
        db.delete(starboardMessages).where(eq(starboardMessages.originalMessageId, id)).run();
});
function fixture(isPublic: boolean) {
    const id = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
    ids.push(id);
    let posts = 0;
    let edits = 0;
    const channel = {
        guildId: 'guild',
        nsfw: false,
        send: async (payload: { content: string }) => {
            posts++;
            return { content: payload.content, id: 'starboard-post' };
        },
        messages: {
            fetch: async () => ({
                edit: async () => {
                    edits++;
                },
                delete: async () => {},
            }),
        },
    };
    const message = {
        id,
        partial: false,
        author: {
            bot: false,
            tag: 'user',
            displayAvatarURL: () => 'https://example.com/avatar.png',
        },
        guild: { roles: { everyone: { id: 'everyone' } } },
        guildId: 'guild',
        content: 'hello',
        createdAt: new Date(),
        url: 'https://discord.com/channels/1/2/3',
        channel: {
            id: 'source',
            type: ChannelType.GuildText,
            isThread: () => false,
            parent: null as { nsfw: boolean } | null,
            nsfw: false,
            permissionsFor: () =>
                new PermissionsBitField(isPublic ? PermissionFlagsBits.ViewChannel : 0n),
        },
        client: { channels: { cache: new Collection([[config.channels.starboard, channel]]) } },
        reactions: {
            cache: new Collection([
                [
                    'star',
                    {
                        emoji: { name: config.starboard.emojis[0] },
                        count: config.starboard.minReactions,
                    },
                ],
            ]),
        },
        attachments: new Collection(),
    };
    return { message, posts: () => posts, edits: () => edits };
}
describe('starboard privacy and concurrency', () => {
    test('private threads cannot be promoted even with public parent permissions', async () => {
        const f = fixture(true);
        f.message.channel.type = ChannelType.PrivateThread;
        f.message.channel.isThread = () => true;
        f.message.channel.parent = { nsfw: false };
        await StarboardService.handleReactionUpdate(f.message as never);
        expect(f.posts()).toBe(0);
    });
    test('public threads inherit their parent age restriction', async () => {
        const f = fixture(true);
        f.message.channel.type = ChannelType.PublicThread;
        f.message.channel.isThread = () => true;
        f.message.channel.parent = { nsfw: true };
        await StarboardService.handleReactionUpdate(f.message as never);
        expect(f.posts()).toBe(0);
    });
    test('private source content is never republished', async () => {
        const f = fixture(false);
        await StarboardService.handleReactionUpdate(f.message as never);
        expect(f.posts()).toBe(0);
        expect(
            db
                .select()
                .from(starboardMessages)
                .where(eq(starboardMessages.originalMessageId, f.message.id))
                .all(),
        ).toHaveLength(0);
    });
    test('100 concurrent reactions create one post and one mapping', async () => {
        const f = fixture(true);
        await Promise.all(
            Array.from({ length: 100 }, () =>
                StarboardService.handleReactionUpdate(f.message as never),
            ),
        );
        expect(f.posts()).toBe(1);
        expect(f.edits()).toBe(99);
        expect(
            db
                .select()
                .from(starboardMessages)
                .where(eq(starboardMessages.originalMessageId, f.message.id))
                .all(),
        ).toHaveLength(1);
    });
    test('lost send response survives restart and nonce expiry, adopting the old post with the new count', async () => {
        for (const belowThreshold of [false, true]) {
            const f = fixture(true);
            const destination = f.message.client.channels.cache.get(config.channels.starboard)!;
            let sends = 0,
                historyReads = 0,
                content = '',
                removed = false;
            const post = {
                id: '987654321012345678',
                author: { id: 'bot' },
                webhookId: null,
                embeds: [{ footer: { text: f.message.id } }],
                get content() {
                    return content;
                },
                edit: async (payload: { content: string }) => {
                    content = payload.content;
                },
                delete: async () => {
                    removed = true;
                },
            };
            Object.assign(destination, {
                client: { user: { id: 'bot' } },
                permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.Administrator),
                send: async (payload: { content: string }) => {
                    sends++;
                    content = payload.content;
                    throw new Error('process lost send response');
                },
                messages: {
                    fetch: async (options: { limit?: number }) => {
                        if (options.limit) {
                            historyReads++;
                            return new Collection([[post.id, post]]);
                        }
                        return post;
                    },
                },
            });
            await expect(StarboardService.handleReactionUpdate(f.message as never)).rejects.toThrow(
                'lost send response',
            );
            const mapping = () =>
                db
                    .select()
                    .from(starboardMessages)
                    .where(eq(starboardMessages.originalMessageId, f.message.id))
                    .get();
            expect(mapping()?.starboardMessageId).toBeNull();
            const count = belowThreshold ? 0 : config.starboard.minReactions + 4;
            f.message.reactions.cache.first()!.count = count;
            await StarboardService.handleReactionUpdate(f.message as never);
            expect(sends).toBe(1);
            expect(historyReads).toBe(1);
            if (belowThreshold) {
                expect(removed).toBe(true);
                expect(mapping()).toBeUndefined();
            } else {
                expect(mapping()?.starboardMessageId).toBe(post.id);
                expect(content).toContain('**' + count + '**');
            }
        }
    });
    test('failed mapping commit cannot duplicate a post, even beyond the first page of history', async () => {
        const f = fixture(true);
        const destination = f.message.client.channels.cache.get(config.channels.starboard)!;
        const bot = { id: 'snoojote' };
        let sends = 0,
            edits = 0,
            readable = false;
        const base = BigInt(f.message.id) + 5000000n;
        const post = {
            id: base.toString(),
            author: bot,
            webhookId: null,
            embeds: [{ footer: { text: f.message.id } }],
            content: 'old count',
            edit: async () => {
                edits++;
            },
        };
        const newer = new Collection(
            Array.from({ length: 100 }, (_, i) => {
                const id = (base + BigInt(i + 1)).toString();
                return [
                    id,
                    {
                        ...post,
                        id,
                        author: i % 2 ? bot : { id: 'other-bot' },
                        webhookId: i % 2 ? 'hook' : null,
                    },
                ] as const;
            }),
        );
        const pages: (string | undefined)[] = [];
        Object.assign(destination, {
            client: { user: bot },
            permissionsFor: () =>
                new PermissionsBitField(readable ? PermissionFlagsBits.Administrator : 0n),
            send: async (payload: { content: string }) => {
                sends++;
                return { id: post.id, content: payload.content };
            },
            messages: {
                fetch: async (options: { limit?: number; before?: string }) => {
                    if (!options.limit) return post;
                    pages.push(options.before);
                    return options.before ? new Collection([[post.id, post]]) : newer;
                },
            },
        });
        sqlite.exec(
            "CREATE TEMP TRIGGER fail_starboard_mapping BEFORE UPDATE OF starboard_message_id ON starboard_messages BEGIN SELECT RAISE(ABORT,'failed mapping commit'); END",
        );
        try {
            await expect(
                StarboardService.handleReactionUpdate(f.message as never),
            ).rejects.toThrow();
        } finally {
            sqlite.exec('DROP TRIGGER fail_starboard_mapping');
        }
        expect(sends).toBe(1);
        await expect(StarboardService.handleReactionUpdate(f.message as never)).rejects.toThrow(
            'history',
        );
        readable = true;
        await StarboardService.handleReactionUpdate(f.message as never);
        expect(pages).toEqual([undefined, (base + 1n).toString()]);
        expect(sends).toBe(1);
        expect(edits).toBe(1);
        expect(
            db
                .select()
                .from(starboardMessages)
                .where(eq(starboardMessages.originalMessageId, f.message.id))
                .get()?.starboardMessageId,
        ).toBe(post.id);
    });
    test('NSFW content cannot be promoted to a non-NSFW destination', async () => {
        const f = fixture(true);
        f.message.channel.nsfw = true;
        await StarboardService.handleReactionUpdate(f.message as never);
        expect(f.posts()).toBe(0);
    });
});
