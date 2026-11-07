import { Events, type GuildMember } from 'discord.js';
import { recordRequesterAvailability } from '../services/ticketWaitLifecycle.js';

export const name = Events.GuildMemberAdd;
export const once = false;
export const execute = (member: GuildMember) => {
    if (member.joinedTimestamp != null)
        recordRequesterAvailability(member.guild.id, member.id, true, member.joinedTimestamp);
};
