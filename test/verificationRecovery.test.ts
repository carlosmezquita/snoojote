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
import { reconcileGuild } from '../src/features/moderation/events/verificationReady.js';
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
