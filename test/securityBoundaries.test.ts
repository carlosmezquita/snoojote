import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
    Collection,
    PermissionsBitField,
    SlashCommandBuilder,
    PermissionFlagsBits,
    type ChatInputCommandInteraction,
} from 'discord.js';
import { config } from '../src/config.js';
import { type DiscordBot } from '../src/core/client.js';
import { registerEvent } from '../src/core/handlers/eventHandler.js';
import { executeCommand } from '../src/core/handlers/commandHandler.js';
import { isLinkWhitelisted, extractLinks } from '../src/shared/utils/links.js';
import { execute as moderate } from '../src/features/moderation/events/linkSpam.js';
import { execute as memberJoin } from '../src/features/moderation/events/memberJoinTrap.js';
import { redactSecrets } from '../src/utils/logger.js';

const guildId = config.guildId;
afterEach(() => {
    config.guildId = guildId;
});

describe('URL allowlist boundaries', () => {
    const allowed = ['https://example.com', 'https://discord.gg/community'];
    for (const url of [
        'https://example.com.evil.test',
        'https://example.com@evil.test',
        'https://evil.test/?next=https://example.com',
        'https://example.com:8443',
        'http://example.com',
        'https://discord.gg/community-evil',
        'not a url',
    ]) {
        test(`rejects ${url}`, () => expect(isLinkWhitelisted(url, allowed)).toBe(false));
    }
    test('accepts exact host and path boundaries, including normalized host casing', () => {
        expect(isLinkWhitelisted('https://EXAMPLE.COM/path?q=1', allowed)).toBe(true);
        expect(isLinkWhitelisted('https://discord.gg/community/path', allowed)).toBe(true);
        expect(isLinkWhitelisted('https://discord.gg/community', allowed)).toBe(true);
        expect(isLinkWhitelisted('https://example.com', ['malformed'])).toBe(false);
        expect(extractLinks('(<https://example.com/a>), HTTPS://evil.test/path.')).toEqual([
            'https://example.com/a',
            'HTTPS://evil.test/path',
        ]);
    });
});

function clientFixture() {
    const errors: unknown[] = [];
    const client = Object.assign(new EventEmitter(), {
        commands: new Collection(),
        logger: {
            debug: () => {},
            error: (...args: unknown[]) => {
                errors.push(args);
            },
            warn: () => {},
            info: () => {},
        },
    }) as unknown as DiscordBot;
    return { client, errors };
}

describe('event and command boundaries', () => {
    test('catches synchronous throws and rejected async events with handler context', async () => {
        const { client, errors } = clientFixture();
        registerEvent(client, {
            name: 'clientReady',
            once: true,
            execute: () => {
                throw new Error('sync');
            },
        });
        registerEvent(client, {
            name: 'clientReady',
            execute: async () => {
                throw new Error('async');
            },
        });
        client.emit('clientReady', client as never);
        await new Promise(setImmediate);
        expect(errors).toHaveLength(2);
        client.emit('clientReady', client as never);
        await new Promise(setImmediate);
        expect(errors).toHaveLength(3);
    });

    test('ignores events from a different guild', async () => {
        config.guildId = 'configured';
        const { client } = clientFixture();
        let calls = 0;
        registerEvent(client, {
            name: 'messageCreate',
            execute: () => {
                calls++;
            },
        });
        client.emit('messageCreate', { guildId: 'other' } as never);
        client.emit('messageCreate', { guildId: 'configured' } as never);
        await new Promise(setImmediate);
        expect(calls).toBe(1);
    });

    for (const scenario of ['dm', 'other guild', 'missing permission']) {
        test(`denies a command with ${scenario} at runtime`, async () => {
            config.guildId = 'configured';
            const { client } = clientFixture();
            let executed = false;
            let denied = false;
            client.commands.set('admin-test', {
                permissionLevel: 'admin',
                data: new SlashCommandBuilder()
                    .setName('admin-test')
                    .setDescription('test')
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
                execute: () => {
                    executed = true;
                },
            });
            const interaction = {
                commandName: 'admin-test',
                user: { id: 'user' },
                inGuild: () => scenario !== 'dm',
                guildId: scenario === 'other guild' ? 'other' : 'configured',
                memberPermissions: new PermissionsBitField(0n),
                reply: async () => {
                    denied = true;
                },
            } as unknown as ChatInputCommandInteraction;
            await executeCommand(interaction, client);
            expect(executed).toBe(false);
            expect(denied).toBe(true);
        });
    }
});

describe('moderation isolation', () => {
    test('alert delivery failures cannot prevent spam deletion or banning', async () => {
        const userId = randomUUID();
        let deleted = 0;
        let banned = 0;
        const member = {
            permissions: new PermissionsBitField(0n),
            roles: { cache: new Collection() },
            send: async () => {},
            ban: async () => {
                banned++;
            },
        };
        const message = {
            id: 'message',
            author: { id: userId, bot: false, send: async () => {}, toString: () => userId },
            content: `https://evil.test/${'x'.repeat(2000)}`,
            member,
            guild: { id: 'guild' },
            guildId: 'guild',
            channelId: 'channel',
            channel: { toString: () => 'channel' },
            delete: async () => {
                deleted++;
            },
        };
        const { client } = clientFixture();
        Object.assign(client, {
            channels: {
                cache: new Collection([
                    [
                        config.channels.alerts,
                        {
                            isTextBased: () => true,
                            send: async () => {
                                throw new Error('Forbidden');
                            },
                        },
                    ],
                ]),
            },
        });
        for (let i = 0; i < 4; i++) await moderate(message as never, client);
        expect(deleted).toBe(3);
        expect(banned).toBe(1);
    });

    test('invite lookup failure does not prevent member verification routing', async () => {
        const { client } = clientFixture();
        let welcomed = false;
        client.on('guildMemberVerified' as never, () => {
            welcomed = true;
        });
        const member = {
            id: 'user',
            user: { tag: 'user', createdTimestamp: Date.now() - 100 * 86_400_000 },
            guild: {
                id: 'guild',
                invites: {
                    fetch: async () => {
                        throw new Error('Forbidden');
                    },
                },
            },
        };
        await memberJoin(member as never, client);
        expect(welcomed).toBe(true);
    });

    test('redacts literal secrets without interpreting regex characters', () => {
        expect(redactSecrets('secret=a.b[0] token=a.b[0]', ['a.b[0]', undefined])).toBe(
            'secret=[REDACTED] token=[REDACTED]',
        );
    });
});
