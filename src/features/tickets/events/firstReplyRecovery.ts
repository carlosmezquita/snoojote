import { ChannelType, Events, type TextChannel } from 'discord.js';
import { and, eq, gte, isNull, or } from 'drizzle-orm';
import { config } from '../../../config.js';
import type { DiscordBot } from '../../../core/client.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import responseTimeService from '../services/responseTimeService.js';
import { isTicketStaff } from '../utils/ticketStaff.js';

export const name = Events.ClientReady;
export const once = true;
const startedAt = new Date();

type OpenTicket = Pick<typeof tickets.$inferSelect, 'id' | 'userId' | 'createdAt'>;

export async function scanFirstReply(channel: TextChannel, ticket: OpenTicket, until: Date) {
    let after = channel.id;
    for (;;) {
        const page = await channel.messages.fetch({ after, limit: 100, cache: false });
        const messages = [...page.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        for (const message of messages) {
            if (message.createdAt > until) return;
            if (
                message.createdAt < ticket.createdAt ||
                message.author.bot ||
                message.author.id === ticket.userId
            )
                continue;
            const member =
                message.member ??
                (await channel.guild.members.fetch(message.author.id).catch((error: unknown) => {
                    if (
                        error &&
                        typeof error === 'object' &&
                        'code' in error &&
                        error.code === 10007
                    )
                        return null;
                    throw error;
                }));
            if (member && isTicketStaff(member)) {
                await responseTimeService.recordResponse(
                    ticket.id,
                    member.id,
                    message.createdAt,
                    message.id,
                    'history',
                );
                return;
            }
        }
        if (page.size < 100) return;
        after = messages[messages.length - 1]!.id;
    }
}

export async function execute(client: DiscordBot) {
    const until = new Date();
    const candidates = db
        .select()
        .from(tickets)
        .where(
            and(
                eq(tickets.status, 'open'),
                isNull(tickets.requesterUnavailableAt),
                or(isNull(tickets.waitOutcome), eq(tickets.waitOutcome, 'responded')),
                or(isNull(tickets.firstResponseAt), gte(tickets.firstResponseAt, startedAt)),
            ),
        )
        .all();
    let failures = 0;
    for (const ticket of candidates) {
        if (ticket.guildId && config.guildId && ticket.guildId !== config.guildId) continue;
        try {
            const channel = await client.channels.fetch(ticket.channelId);
            if (
                channel?.type !== ChannelType.GuildText ||
                (ticket.guildId && ticket.guildId !== channel.guildId) ||
                (config.guildId && config.guildId !== channel.guildId)
            )
                continue;
            await scanFirstReply(channel, ticket, until);
        } catch (error) {
            failures++;
            client.logger.warn('Ticket reply history unavailable', { ticketId: ticket.id, error });
        }
    }
    client.logger.info('Ticket first reply recovery finished', {
        candidates: candidates.length,
        failures,
    });
}
