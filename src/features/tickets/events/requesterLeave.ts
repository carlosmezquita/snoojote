import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { requesterTickets, recordRequesterAvailability } from '../services/ticketWaitLifecycle.js';

export const name = Events.GuildMemberRemove;
export const once = false;
export const execute = async (member: GuildMember | PartialGuildMember) => {
    const guild = member.guild;
    if (member.joinedTimestamp != null) {
        recordRequesterAvailability(guild.id, member.id, false, member.joinedTimestamp);
        return;
    }
    // Uncached removals carry only a user ID. Ask Discord for current
    // membership, and fence an absent result against concurrent rejoins.
    const observed = new Date();
    const rows = db
        .select({ id: tickets.id, since: tickets.requesterMembershipSince })
        .from(tickets)
        .where(requesterTickets(guild.id, member.id))
        .all();
    if (!rows.length) return;
    let current: GuildMember;
    try {
        current = await guild.members.fetch({ user: member.id, force: true, cache: false });
    } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 10007)
            throw error;
        recordRequesterAvailability(
            guild.id,
            member.id,
            false,
            null,
            observed,
            new Map(rows.map((row) => [row.id, row.since])),
        );
        return;
    }
    if (current.joinedTimestamp != null)
        recordRequesterAvailability(guild.id, member.id, true, current.joinedTimestamp);
};
