import { afterEach, describe, expect, test } from 'bun:test';
import { Collection, PermissionsBitField, PermissionFlagsBits, ChannelType } from 'discord.js';
import { eq } from 'drizzle-orm';
import db from '../src/database/db.js';
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
        send: async () => {
            posts++;
            return { id: 'starboard-post' };
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
    test('NSFW content cannot be promoted to a non-NSFW destination', async () => {
        const f = fixture(true);
        f.message.channel.nsfw = true;
        await StarboardService.handleReactionUpdate(f.message as never);
        expect(f.posts()).toBe(0);
    });
});
