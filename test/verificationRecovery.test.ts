import { expect, spyOn, test } from 'bun:test';
import {
    ChannelType,
    PermissionFlagsBits,
    PermissionsBitField,
    type Guild,
    type GuildMember,
    type GuildChannel,
} from 'discord.js';
import verifier, {
    VerificationService,
} from '../src/features/moderation/services/VerificationService.js';
import { VerificationStateService } from '../src/features/moderation/services/VerificationStateService.js';
import {
    membershipKey,
    readVerification,
    saveVerification,
} from '../src/features/moderation/services/verificationJournal.js';
import { ensureSuspectLock } from '../src/features/moderation/services/suspectLock.js';
import { quarantineJoin } from '../src/features/moderation/services/standbyQuarantine.js';
import {
    drainQuarantines,
    reconcileGuild,
} from '../src/features/moderation/events/verificationReady.js';
import type { DiscordBot } from '../src/core/client.js';

test('a restarted verifier restores the same membership, challenge, attempts and deadline', async () => {
    const guild = {
        id: 'recovery',
        channels: { fetch: async () => ({ type: ChannelType.GuildText }) },
    };
    const member = {
        id: 'member',
        guild,
        joinedTimestamp: 123,
        roles: { cache: { has: () => true } },
    } as unknown as GuildMember;
    const key = membershipKey(member);
    const expiresAt = Date.now() + 120000;
    saveVerification(key, {
        guildId: guild.id,
        challengeId: 'opaque',
        answer: 'CODE',
        channelId: 'channel',
        mainMsgId: 'msg',
        warningMsgId: null,
        attempts: 2,
        processing: false,
        timeouts: [],
        expiresAt,
    });
    const memory = new VerificationStateService();
    const verifier = new VerificationService(memory);
    const client = {} as DiscordBot;
    await verifier.handleMemberJoin(member, client, 1000);
    const restored = memory.get(member.id, guild.id)!;
    expect(restored).toMatchObject({
        challengeId: 'opaque',
        attempts: 2,
        answer: 'CODE',
        expiresAt,
    });
    restored.timeouts.forEach(clearTimeout);
    memory.delete(member.id, guild.id);
    saveVerification(key, undefined, true);
    await verifier.handleMemberJoin(member, client, 1000);
    expect(memory.has(member.id, guild.id)).toBe(false);
    expect(readVerification(key)?.challenge).toBeNull();
    expect(membershipKey({ ...member, joinedTimestamp: 124 } as GuildMember)).not.toBe(key);
});

test('reconciliation locks a new channel with a partial deny and leaves older channels alone', async () => {
    let edits = 0;
    const partial = { deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) };
    const channel = {
        createdTimestamp: 20,
        permissionOverwrites: {
            cache: { get: () => partial },
            edit: async () => {
                edits++;
                partial.deny.add(PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect);
            },
        },
    };
    const guild = {
        channels: { fetch: async () => [channel, { ...channel, createdTimestamp: 2 }] },
        members: { fetch: async () => [] },
    } as unknown as Guild;
    await reconcileGuild(guild, {} as DiscordBot, 10);
    expect(edits).toBe(1);
    await ensureSuspectLock(channel as unknown as GuildChannel);
    expect(edits).toBe(1);
});

test('reconciliation checks account age at join and skips established or previously observed members', async () => {
    const day = 86_400_000;
    const guild = {
        id: 'scan',
        channels: { fetch: async () => [] },
        members: { fetch: async () => members },
    } as unknown as Guild;
    const makeMember = (id: string, joinedTimestamp: number, age: number) =>
        ({
            id,
            guild,
            joinedTimestamp,
            user: { createdTimestamp: joinedTimestamp - age },
            roles: { cache: { has: () => false } },
        }) as unknown as GuildMember;
    const members = [
        makeMember('missed', 100 * day, 90 * day),
        makeMember('old-account', 100 * day, 91 * day),
        makeMember('old-membership', 98 * day, day),
    ];
    const handle = spyOn(verifier, 'handleMemberJoin').mockResolvedValue(undefined);
    try {
        await reconcileGuild(guild, {} as DiscordBot, 99 * day);
        expect(handle).toHaveBeenCalledTimes(1);
        expect(handle.mock.calls[0]?.[0].id).toBe('missed');
    } finally {
        handle.mockRestore();
    }
});

test('standby reserves and restricts a join; only the primary starts a challenge, and replays preserve completion', async () => {
    let restricted = false,
        adds = 0,
        starts = 0;
    const guild = { id: 'handoff', members: { fetch: async () => member } } as unknown as Guild;
    const member = {
        guild,
        id: 'member',
        joinedTimestamp: 100000,
        user: { createdTimestamp: 50000 },
        roles: {
            add: async () => {
                restricted = true;
                adds++;
            },
            cache: { has: () => restricted },
        },
    } as unknown as GuildMember;
    const key = membershipKey(member);
    const client = {
        logger: {
            error: () => {
                throw new Error('unexpected recovery failure');
            },
        },
    } as unknown as DiscordBot;
    const start = spyOn(verifier, 'handleMemberJoin').mockImplementation(async (m) => {
        expect(m).toBe(member);
        starts++;
        saveVerification(key, undefined, true);
        restricted = false;
    });
    try {
        await quarantineJoin(member);
        await quarantineJoin(member);
        expect(readVerification(key)).toMatchObject({ status: 'pending', challenge: null });
        expect(starts).toBe(0);
        expect(restricted).toBe(true);
        await drainQuarantines(guild, client);
        await quarantineJoin(member);
        await drainQuarantines(guild, client);
        expect(readVerification(key)?.status).toBe('completed');
        expect([adds, starts, restricted]).toEqual([1, 1, false]);
    } finally {
        start.mockRestore();
    }
});

test('an overlapping standby delivery leaves an active main-owned CAPTCHA intact', async () => {
    const member = {
        guild: { id: 'race' },
        id: 'user',
        joinedTimestamp: 90000,
        user: { createdTimestamp: 1 },
        roles: {
            add: async () => {
                throw new Error('unexpected role mutation');
            },
        },
    } as unknown as GuildMember;
    const key = membershipKey(member);
    saveVerification(key, {
        guildId: 'race',
        channelId: 'channel',
        mainMsgId: 'msg',
        warningMsgId: null,
        challengeId: 'original',
        answer: 'secret',
        expiresAt: Date.now() + 60000,
        attempts: 1,
        timeouts: [],
        processing: false,
    });
    const before = readVerification(key);
    await quarantineJoin(member);
    expect(readVerification(key)).toEqual(before);
});

test('primary startup and live join racing on a standby reservation create a single CAPTCHA', async () => {
    const state = new VerificationStateService();
    const primary = new VerificationService(state, {
        generateCaptchaText: () => 'ABCDE',
        drawCaptchaImage: async () => Buffer.from('fixture'),
    });
    let channels = 0,
        messages = 0;
    const guild = {
        id: 'startup-handoff',
        channels: {
            fetch: async () => null,
            create: async () => {
                channels++;
                return {
                    id: 'channel',
                    send: async () => {
                        messages++;
                        return { id: 'challenge-message' };
                    },
                };
            },
        },
    };
    const member = {
        id: 'joining',
        guild,
        joinedTimestamp: 12345,
        user: { username: 'joining', createdTimestamp: 100 },
        roles: { add: async () => {}, cache: { has: () => true } },
    } as unknown as GuildMember;
    const client = {
        user: { id: 'bot' },
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    } as unknown as DiscordBot;
    await quarantineJoin(member);
    try {
        await Promise.all([
            primary.handleMemberJoin(member, client, 12245),
            primary.handleMemberJoin(member, client, 12245),
        ]);
        expect([channels, messages]).toEqual([1, 1]);
        const before = readVerification(membershipKey(member));
        expect(JSON.parse(before!.challenge!).mainMsgId).toBe('challenge-message');
        await quarantineJoin(member);
        expect(readVerification(membershipKey(member))).toEqual(before);
    } finally {
        state.get(member.id, guild.id)?.timeouts.forEach(clearTimeout);
    }
});
