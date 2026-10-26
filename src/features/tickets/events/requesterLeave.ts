import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { recordRequesterAvailability } from '../services/ticketWaitLifecycle.js';

export const name = Events.GuildMemberRemove;
export const once = false;
export const execute = (member: GuildMember | PartialGuildMember) => {
    recordRequesterAvailability(member.guild.id, member.id, false);
};
