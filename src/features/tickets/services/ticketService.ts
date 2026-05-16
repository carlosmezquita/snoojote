import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    type Guild,
    PermissionFlagsBits,
    type TextChannel,
    type User,
    OverwriteType,
} from 'discord.js';
import { and, count, eq } from 'drizzle-orm';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { config } from '../../../config.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';
import { DMService, DMType } from '../../../shared/services/DMService.js';
import { type TicketOptionConfig } from '../config/TicketConfig.js';
import logger from '../../../utils/logger.js';
import { formatDuration } from './waitTimeEstimator.js';

type TicketRecord = typeof tickets.$inferSelect;

export class TicketService {
    async createTicket(
        user: User,
        guild: Guild,
        option: TicketOptionConfig,
        modalData: { question: string; answer: string }[],
    ): Promise<TextChannel | null> {
        const existingOpenTickets = await db
            .select({ value: count() })
            .from(tickets)
            .where(and(eq(tickets.userId, user.id), eq(tickets.status, 'open')))
            .get();

        if ((existingOpenTickets?.value ?? 0) >= config.tickets.maxOpenPerUser) {
            logger.info('Ticket creation rejected by open ticket limit', {
                userId: user.id,
                guildId: guild.id,
                openTicketCount: existingOpenTickets?.value ?? 0,
                maxOpenPerUser: config.tickets.maxOpenPerUser,
                optionId: option.id,
            });
            return null;
        }

        try {
            const channelName = `${option.channelPrefix}${user.username.substring(0, 10)}`;

            const permissionOverwrites: any[] = [
                {
                    id: guild.id,
                    type: OverwriteType.Role,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    id: user.id,
                    type: OverwriteType.Member,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.AttachFiles,
                    ],
                },
                {
                    id: guild.client.user!.id,
                    type: OverwriteType.Member,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ManageChannels,
                    ],
                },
            ];

            for (const roleId of option.adminRoles || []) {
                if (!roleId) continue;
                permissionOverwrites.push({
                    id: roleId,
                    type: OverwriteType.Role,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                });
            }

            const channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: option.categoryId || config.channels.ticketCategory || undefined,
                permissionOverwrites,
            });

            const responseTimeService = (await import('./responseTimeService.js')).default;
            const staffOnlineAtCreation = await responseTimeService.getActiveStaffCount(guild);
            const staffCapacityAtCreation =
                await responseTimeService.getWeightedStaffCapacity(guild);
            const openTicketsAtCreation = await responseTimeService.getOpenTicketCount();
            const unansweredQueueLength = await responseTimeService.getUnansweredQueueLength();
            const estimateResult = await responseTimeService.createEstimate(
                guild,
                unansweredQueueLength,
            );

            const insertedTicket = await db
                .insert(tickets)
                .values({
                    channelId: channel.id,
                    userId: user.id,
                    status: 'open',
                    createdAt: new Date(),
                    staffOnlineAtCreation,
                    staffCapacityAtCreation,
                    openTicketsAtCreation,
                })
                .returning({ id: tickets.id })
                .get();

            await responseTimeService.recordEstimateSnapshot(insertedTicket.id, estimateResult);
            logger.info('Ticket channel created', {
                userId: user.id,
                guildId: guild.id,
                channelId: channel.id,
                optionId: option.id,
                staffOnlineAtCreation,
                staffCapacityAtCreation,
                openTicketsAtCreation,
                estimatedWaitMs: estimateResult.estimatedMs,
            });

            const estimate = formatDuration(estimateResult.estimatedMs);

            const embed = createEmbed(
                option.openMessage || `Ticket de ${user.username}`,
                option.ticketWelcomeMessage +
                    '\n\n' +
                    `**Tiempo estimado de respuesta:** ${estimate}\n\n` +
                    modalData.map((d) => `**${d.question}**\n${d.answer}`).join('\n\n'),
                Colors.Info,
            );

            if (option.thumbnailUrl) embed.setThumbnail(option.thumbnailUrl);
            if (option.imageUrl) embed.setImage(option.imageUrl);

            let content = `<@${user.id}>`;
            if (option.pingHere) content += ' @here';
            if (option.pingEveryone) content += ' @everyone';
            if (option.pingCustomRoleId) content += ` <@&${option.pingCustomRoleId}>`;

            await channel.send({
                content,
                embeds: [embed],
                components: [this.openTicketControls()],
            });

            if (option.enableDmOnOpen) {
                await DMService.sendNeutral(
                    user,
                    'Ticket Created / Ticket Creado',
                    `Your ticket has been created in **${guild.name}**.\nSu ticket ha sido creado en **${guild.name}**.\n\n${channel.toString()}`,
                );
            }

            return channel;
        } catch (error) {
            logger.error('Failed to create ticket', {
                userId: user.id,
                guildId: guild.id,
                optionId: option.id,
                error,
            });
            throw error;
        }
    }

    async getTicketByChannel(channelId: string): Promise<TicketRecord | undefined> {
        return await db.select().from(tickets).where(eq(tickets.channelId, channelId)).get();
    }

    async claimTicket(
        channel: TextChannel,
        claimer: User,
    ): Promise<{ success: boolean; message: string }> {
        const ticket = await this.requireTicket(channel);
        if (ticket.claimedBy && ticket.claimedBy !== claimer.id) {
            return {
                success: false,
                message: `Este ticket ya está reclamado por <@${ticket.claimedBy}>.`,
            };
        }

        await db
            .update(tickets)
            .set({ claimedBy: claimer.id })
            .where(eq(tickets.channelId, channel.id));

        await channel.send(`📌 Ticket reclamado por ${claimer.toString()}.`);
        return { success: true, message: 'Ticket reclamado.' };
    }

    async unclaimTicket(
        channel: TextChannel,
        actor: User,
    ): Promise<{ success: boolean; message: string }> {
        await this.requireTicket(channel);
        await db.update(tickets).set({ claimedBy: null }).where(eq(tickets.channelId, channel.id));

        await channel.send(`📌 Ticket liberado por ${actor.toString()}.`);
        return { success: true, message: 'Ticket liberado.' };
    }

    async addUser(channel: TextChannel, user: User, actor: User): Promise<void> {
        await this.requireTicket(channel);
        await channel.permissionOverwrites.edit(user.id, {
            ViewChannel: true,
            SendMessages: true,
            AttachFiles: true,
        });
        await channel.send(`➕ ${actor.toString()} añadió a ${user.toString()} al ticket.`);
    }

    async removeUser(channel: TextChannel, user: User, actor: User): Promise<void> {
        await this.requireTicket(channel);
        await channel.permissionOverwrites.edit(user.id, {
            ViewChannel: false,
            SendMessages: false,
            AttachFiles: false,
        });
        await channel.send(`➖ ${actor.toString()} retiró a ${user.toString()} del ticket.`);
    }

    async closeTicket(
        channel: TextChannel,
        closer: User,
        reason: string = 'No reason provided.',
    ): Promise<void> {
        const ticket = await this.requireTicket(channel);
        const now = new Date();

        await db
            .update(tickets)
            .set({
                status: 'closed',
                closedAt: now,
                closedBy: closer.id,
                closeReason: reason,
            })
            .where(eq(tickets.channelId, channel.id));

        await channel.permissionOverwrites
            .edit(ticket.userId, {
                ViewChannel: true,
                SendMessages: false,
                AttachFiles: false,
            })
            .catch((error) => {
                logger.warn('Failed to update ticket owner permissions while closing ticket', {
                    channelId: channel.id,
                    ticketOwnerId: ticket.userId,
                    closedBy: closer.id,
                    error,
                });
            });
        const transcript = await this.generateTranscript(channel);
        await this.sendTranscriptToOwner(channel, ticket, closer, reason, transcript);
        await this.sendTranscriptToLog(channel, ticket, closer, reason, transcript);

        await channel.send({
            content: `🔒 Ticket cerrado por ${closer.toString()}.\n**Motivo:** ${reason}`,
            files: [this.transcriptFile(channel, transcript)],
            components: [this.closedTicketControls()],
        });
    }

    async reopenTicket(channel: TextChannel, actor: User): Promise<void> {
        const ticket = await this.requireTicket(channel);

        await db
            .update(tickets)
            .set({
                status: 'open',
                closedAt: null,
                closedBy: null,
                closeReason: null,
                deletedAt: null,
            })
            .where(eq(tickets.channelId, channel.id));

        await channel.permissionOverwrites
            .edit(ticket.userId, {
                ViewChannel: true,
                SendMessages: true,
                AttachFiles: true,
            })
            .catch((error) => {
                logger.warn('Failed to restore ticket owner permissions while reopening ticket', {
                    channelId: channel.id,
                    ticketOwnerId: ticket.userId,
                    reopenedBy: actor.id,
                    error,
                });
            });

        await channel.send({
            content: `🔓 Ticket reabierto por ${actor.toString()}.`,
            components: [this.openTicketControls()],
        });
    }

    async deleteTicket(
        channel: TextChannel,
        actor: User,
        reason: string = 'Ticket deleted.',
    ): Promise<void> {
        const ticket = await this.requireTicket(channel);
        const transcript = await this.generateTranscript(channel);

        await this.sendTranscriptToLog(channel, ticket, actor, reason, transcript);

        await db
            .update(tickets)
            .set({
                status: 'deleted',
                deletedAt: new Date(),
            })
            .where(eq(tickets.channelId, channel.id));

        await channel.send({
            content: `🗑️ Ticket eliminado por ${actor.toString()}. El canal se borrará en 5 segundos.`,
            files: [this.transcriptFile(channel, transcript)],
        });

        setTimeout(() => {
            void channel.delete(`Ticket deleted by ${actor.tag}`).catch((error) => {
                logger.error('Failed to delete ticket channel', {
                    channelId: channel.id,
                    deletedBy: actor.id,
                    error,
                });
            });
        }, 5000);
    }

    async generateTranscript(channel: TextChannel): Promise<string> {
        const messages = await channel.messages.fetch({ limit: 100 });
        const sortedMessages = messages.reverse();

        let transcript = `Transcript for ${channel.name}\nGenerated at ${new Date().toISOString()}\n\n`;

        sortedMessages.forEach((msg) => {
            const time = msg.createdAt.toISOString();
            const author = msg.author.tag;
            const content = msg.content || '[no text content]';
            transcript += `[${time}] ${author}: ${content}\n`;
            if (msg.attachments.size > 0) {
                transcript += `[Attachments]: ${msg.attachments.map((a) => a.url).join(', ')}\n`;
            }
        });

        return transcript;
    }

    private async requireTicket(channel: TextChannel): Promise<TicketRecord> {
        const ticket = await this.getTicketByChannel(channel.id);
        if (!ticket || ticket.status === 'deleted') {
            throw new Error('This channel is not an active ticket.');
        }
        return ticket;
    }

    private openTicketControls() {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Cerrar Ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒'),
        );
    }

    private closedTicketControls() {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('reopen_ticket')
                .setLabel('Reabrir')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🔓'),
            new ButtonBuilder()
                .setCustomId('delete_ticket')
                .setLabel('Eliminar')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️'),
        );
    }

    private transcriptFile(channel: TextChannel, transcript: string) {
        return new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), {
            name: `transcript-${channel.name}.txt`,
        });
    }

    private async sendTranscriptToOwner(
        channel: TextChannel,
        ticket: TicketRecord,
        closer: User,
        reason: string,
        transcript: string,
    ) {
        const owner = await channel.client.users.fetch(ticket.userId).catch(() => null);
        if (!owner) {
            logger.warn('Failed to fetch ticket owner for transcript delivery', {
                channelId: channel.id,
                ticketOwnerId: ticket.userId,
            });
            return;
        }

        const dmSent = await DMService.send({
            user: owner,
            type: DMType.Info,
            title: 'Ticket Closed / Ticket Cerrado',
            description: `Ticket closed by ${closer.tag}.\nTicket cerrado por ${closer.tag}.\n\n**Reason / Motivo:** ${reason}`,
            fields: [
                { name: 'Server', value: channel.guild.name, inline: true },
                { name: 'Ticket', value: channel.name, inline: true },
            ],
            files: [this.transcriptFile(channel, transcript)],
        });
        if (!dmSent) {
            logger.info('Ticket transcript DM was not delivered to owner', {
                channelId: channel.id,
                ticketOwnerId: ticket.userId,
            });
        }
    }

    private async sendTranscriptToLog(
        channel: TextChannel,
        ticket: TicketRecord,
        actor: User,
        reason: string,
        transcript: string,
    ) {
        const logChannel = await channel.client.channels
            .fetch(config.channels.transcripts)
            .catch((error) => {
                logger.warn('Failed to fetch ticket transcript log channel', {
                    channelId: channel.id,
                    transcriptChannelId: config.channels.transcripts,
                    error,
                });
                return null;
            });
        if (!logChannel || !logChannel.isTextBased() || !('send' in logChannel)) {
            logger.warn('Ticket transcript log channel is unavailable', {
                channelId: channel.id,
                transcriptChannelId: config.channels.transcripts,
            });
            return;
        }

        try {
            await logChannel.send({
                content: `📄 Transcript for ${channel.name}\nOwner: <@${ticket.userId}>\nAction by: ${actor.toString()}\nReason: ${reason}`,
                files: [this.transcriptFile(channel, transcript)],
            });
        } catch (error) {
            logger.error('Failed to send ticket transcript to log channel', {
                channelId: channel.id,
                transcriptChannelId: config.channels.transcripts,
                ticketOwnerId: ticket.userId,
                actorId: actor.id,
                error,
            });
            throw error;
        }
    }
}

export default new TicketService();
