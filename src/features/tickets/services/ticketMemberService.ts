import { TextChannel, User, PermissionFlagsBits, OverwriteType } from 'discord.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { eq, and } from 'drizzle-orm';

export class TicketMemberService {
    /**
     * Checks if the given channel is an open ticket channel and returns the ticket.
     * @param channelId The ID of the channel to check.
     */
    async getTicket(channelId: string) {
        return await db.select()
            .from(tickets)
            .where(and(eq(tickets.channelId, channelId), eq(tickets.status, 'open')))
            .get();
    }

    /**
     * Checks if the given channel is an open ticket channel.
     * @param channelId The ID of the channel to check.
     */
    async isTicketChannel(channelId: string): Promise<boolean> {
        const ticket = await this.getTicket(channelId);
        return !!ticket;
    }

    /**
     * Adds a user to the ticket channel by granting ViewChannel and SendMessages permissions.
     * @param channel The ticket text channel.
     * @param user The user to add.
     */
    async addMember(channel: TextChannel, user: User): Promise<void> {
        await channel.permissionOverwrites.create(user, {
            ViewChannel: true,
            SendMessages: true,
            AttachFiles: true
        });
    }

    /**
     * Removes a user from the ticket channel by deleting their permission overwrite.
     * @param channel The ticket text channel.
     * @param user The user to remove.
     */
    async removeMember(channel: TextChannel, user: User): Promise<void> {
        // Find if there is an overwrite for this user
        const overwrite = channel.permissionOverwrites.cache.get(user.id);

        if (overwrite) {
            await overwrite.delete();
        }
    }
}

export default new TicketMemberService();
