import { Events, type Invite } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import inviteCache from '../services/InviteCacheService.js';

export const name = Events.InviteDelete;
export const once = false;

export const execute = async (invite: Invite, client: DiscordBot) => {
    if (!invite.guild) return;
    const invites = inviteCache.get(invite.guild.id);
    if (invites) invites.delete(invite.code);
};
