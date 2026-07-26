import { Events, type Message } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { eq, and } from 'drizzle-orm';
import responseTimeService from '../services/responseTimeService.js';
import { isTicketStaff } from '../utils/ticketStaff.js';
import { ticketOptionsList } from '../config/options/index.js';

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message, client: DiscordBot) {
        if (message.author.bot || !message.guild) return;

        // Optimization: Check if channel name starts with ticket prefix or is in ticket category first
        // to avoid unnecessary DB queries on every message.
        let isPotentialTicket = false;
        if (message.channel.isTextBased() && !message.channel.isDMBased()) {
            const channelName = message.channel.name;
            const parentId = message.channel.parentId;

            isPotentialTicket = ticketOptionsList.some(
                (opt) =>
                    (channelName && channelName.startsWith(opt.channelPrefix)) ||
                    parentId === opt.categoryId ||
                    (opt.closedCategoryId && parentId === opt.closedCategoryId),
            );
        }

        if (!isPotentialTicket) return;

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
