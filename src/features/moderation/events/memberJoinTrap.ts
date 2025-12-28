import { Events, GuildMember, Collection } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import inviteCache from '../services/InviteCacheService.js';
import verificationService from '../services/VerificationService.js';

const THREE_MONTHS_MS = 1000 * 60 * 60 * 24 * 90;

export const name = Events.GuildMemberAdd;
export const once = false;

export const execute = async (member: GuildMember, client: DiscordBot) => {
    client.logger.info(`👉 Event Triggered: User ${member.user.tag} joined.`);
    const guild = member.guild;

    const cachedInvites = inviteCache.get(guild.id);
    const newInvites = await guild.invites.fetch();

    // Find used invite
    let usedInvite = newInvites.find(inv => {
        const oldUses = cachedInvites ? cachedInvites.get(inv.code) || 0 : 0;
        return (inv.uses || 0) > oldUses;
    });

    // Update cache
    inviteCache.set(guild.id, new Collection(newInvites.map(inv => [inv.code, inv.uses || 0])));

    client.logger.info(`   -> Invite used: ${usedInvite ? usedInvite.code : "Unknown"}`);

    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    if (accountAgeMs > THREE_MONTHS_MS) {
        client.emit('guildMemberVerified', member);
        return;
    }

    client.logger.warn(`   -> 🚨 TRAP TRIGGERED for ${member.user.tag}`);

    await verificationService.handleMemberJoin(member, client, accountAgeMs);
};
