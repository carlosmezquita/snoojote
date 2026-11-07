import { Events, type Invite } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import inviteCache from '../services/InviteCacheService.js';

export const name = Events.InviteCreate;
export const once = false;

export const execute = async (invite: Invite, client: DiscordBot) => {
    if (!invite.guild) return;
    inviteCache.change(invite.guild.id, invite.code, invite.uses ?? 0);
};
