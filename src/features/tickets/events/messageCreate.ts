import { Events, type Message } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import responseTimeService from '../services/responseTimeService.js';
import { isTicketStaff } from '../utils/ticketStaff.js';

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message, client: DiscordBot) {
        if (message.author.bot || !message.guild) return;

        // Only proceed if the user is ticket staff.
        const member = message.member;
        if (!member) return;
        if (!isTicketStaff(member)) return;

        try {
            const ticket = await db
                .select()
                .from(tickets)
                .where(
                    and(
                        eq(tickets.channelId, message.channel.id),
                        inArray(tickets.status, ['open', 'creating']),
                    ),
                )
                .get();

            if (ticket) {
                // Channels are visible while the welcome message and DM are still being sent.
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
