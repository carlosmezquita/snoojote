import { Events, type GuildMember, Collection } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import inviteCache from '../services/InviteCacheService.js';
import verificationService from '../services/VerificationService.js';

import { youngAccountMs } from '../services/standbyQuarantine.js';

export const name = Events.GuildMemberAdd;
export const once = false;

export const execute = async (member: GuildMember, client: DiscordBot) => {
    const guild = member.guild;

    // Invite attribution is optional; a missing ManageGuild permission must not bypass verification.
    let usedInvite: { code: string } | undefined;
    try {
        const cachedInvites = inviteCache.get(guild.id);
        const newInvites = await guild.invites.fetch();
        usedInvite = newInvites.find(
            (inv) => (inv.uses ?? 0) > (cachedInvites?.get(inv.code) ?? 0),
        );
        inviteCache.set(
            guild.id,
            new Collection(newInvites.map((inv) => [inv.code, inv.uses ?? 0])),
        );
    } catch (error) {
        client.logger.warn('Invite attribution unavailable', { guildId: guild.id, error });
    }

    client.logger.info('Guild member joined', {
        userId: member.id,
        userTag: member.user.tag,
        guildId: guild.id,
        guildName: guild.name,
        inviteCode: usedInvite?.code ?? 'unknown',
    });

    const accountAgeMs = (member.joinedTimestamp ?? Date.now()) - member.user.createdTimestamp;
    if (accountAgeMs > youngAccountMs) {
        client.emit('guildMemberVerified', member);
        return;
    }

    client.logger.warn('Verification trap triggered', {
        userId: member.id,
        userTag: member.user.tag,
        guildId: guild.id,
        accountAgeDays: Number((accountAgeMs / (1000 * 60 * 60 * 24)).toFixed(1)),
        inviteCode: usedInvite?.code ?? 'unknown',
    });

    await verificationService.handleMemberJoin(member, client, accountAgeMs);
};
