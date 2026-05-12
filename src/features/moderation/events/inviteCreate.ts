import { Events, Collection, type Invite } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import inviteCache from '../services/InviteCacheService.js';

export const name = Events.InviteCreate;
export const once = false;

export const execute = async (invite: Invite, client: DiscordBot) => {
    if (!invite.guild) return;
    const invites = inviteCache.get(invite.guild.id) || new Collection<string, number>();
    invites.set(invite.code, invite.uses || 0);
    inviteCache.set(invite.guild.id, invites);
};
