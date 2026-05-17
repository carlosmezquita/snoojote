import { Events, type Message } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { eq, and } from 'drizzle-orm';
import responseTimeService from '../services/responseTimeService.js';
import { isTicketStaff } from '../utils/ticketStaff.js';

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message, client: DiscordBot) {
        if (message.author.bot || !message.guild) return;

        // Check if channel is a ticket channel
        // We can check cache or DB. DB is safer to ensure it's a valid open ticket.
        // Optimization: Check if channel name starts with ticket prefix or is in ticket category first?
        // But prefix is configurable per option.
        // Let's just check DB for this channel ID.

        // Only proceed if the user is ticket staff.
        const member = message.member;
        if (!member) return;
        if (!isTicketStaff(member)) return;

        try {
            const ticket = await db
                .select()
                .from(tickets)
                .where(and(eq(tickets.channelId, message.channel.id), eq(tickets.status, 'open')))
                .get();

            if (ticket) {
                // It is an open ticket and message is from ticket staff.
                await responseTimeService.recordResponse(
                    ticket.id,
                    message.author.id,
                    message.createdAt,
                    message.id,
                );
            }
        } catch (error) {
            client.logger.error(`Error in messageCreate ticket handler: ${error}`);
        }
    },
};
