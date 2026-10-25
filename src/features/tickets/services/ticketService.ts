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
import { and, count, eq, inArray, isNull, or } from 'drizzle-orm';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { config } from '../../../config.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';
import { DMService, DMType } from '../../../shared/services/DMService.js';
import { type TicketOptionConfig } from '../config/TicketConfig.js';
import logger from '../../../utils/logger.js';
import { formatDuration } from './waitTimeEstimator.js';
import { getTicketStaffRoleIds } from '../utils/ticketStaff.js';
import { randomUUID } from 'crypto';
import responseTimeService from './responseTimeService.js';

type TicketRecord = typeof tickets.$inferSelect;

type ResponseTimes = Pick<
    typeof responseTimeService,
    | 'getStaffCapacity'
    | 'getOpenTicketCount'
    | 'getUnansweredQueueLength'
    | 'createEstimate'
    | 'recordEstimateSnapshot'
>;

export class TicketService {
    private readonly creating = new Set<number>();
    constructor(private readonly responseTimes: ResponseTimes = responseTimeService) {}

    async createTicket(
        user: User,
        guild: Guild,
        option: TicketOptionConfig,
        modalData: { question: string; answer: string }[],
    ): Promise<TextChannel | null> {
        // Reserve synchronously in SQLite before the first Discord request.
        const reservation = db.transaction((tx) => {
            const existing = tx
                .select({ value: count() })
                .from(tickets)
                .where(
                    and(
                        eq(tickets.userId, user.id),
                        inArray(tickets.status, ['open', 'creating', 'creation_failed']),
                    ),
                )
                .get();
            if ((existing?.value ?? 0) >= config.tickets.maxOpenPerUser) return null;
            return tx
                .insert(tickets)
                .values({
                    channelId: `pending:${randomUUID()}`,
                    guildId: guild.id,
                    userId: user.id,
                    optionId: option.id,
                    status: 'creating',
                })
                .returning()
                .get();
        });
        if (!reservation) return null;
        this.creating.add(reservation.id);
        let channel: TextChannel | undefined;
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

            for (const roleId of getTicketStaffRoleIds(option.adminRoles || [])) {
                permissionOverwrites.push({
                    id: roleId,
                    type: OverwriteType.Role,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                });
            }

            channel = await guild.channels.create({
                name: channelName,
                topic: `snoojote-ticket:${reservation.id}`,
                type: ChannelType.GuildText,
                parent: option.categoryId || config.channels.ticketCategory || undefined,
                permissionOverwrites,
            });

            db.update(tickets)
                .set({ channelId: channel.id })
                .where(eq(tickets.id, reservation.id))
                .run();
            const responseTimeService = this.responseTimes;
            const staffCapacity = await responseTimeService.getStaffCapacity(guild, {
                forceRefresh: true,
            });
            const staffOnlineAtCreation = staffCapacity.activeCount;
            const staffCapacityAtCreation = staffCapacity.weightedCapacity;
            const openTicketsAtCreation = await responseTimeService.getOpenTicketCount();
            const unansweredQueueLength = await responseTimeService.getUnansweredQueueLength();
            const estimateResult = await responseTimeService.createEstimate(
                guild,
                unansweredQueueLength,
            );

            await db
                .update(tickets)
                .set({
                    staffOnlineAtCreation,
                    staffCapacityAtCreation,
                    openTicketsAtCreation,
                    unansweredTicketsAtCreation: unansweredQueueLength,
                })
                .where(eq(tickets.id, reservation.id));
            await responseTimeService.recordEstimateSnapshot(reservation.id, estimateResult);
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

            await db.update(tickets).set({ status: 'open' }).where(eq(tickets.id, reservation.id));
            return channel;
        } catch (error) {
            await this.cleanupIncompleteTicket(reservation, guild, channel);

            logger.error('Failed to create ticket', {
                userId: user.id,
                guildId: guild.id,
                optionId: option.id,
                error,
            });
            throw error;
        } finally {
            this.creating.delete(reservation.id);
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

        const claimed = await db
            .update(tickets)
            .set({ claimedBy: claimer.id })
            .where(
                and(
                    eq(tickets.id, ticket.id),
                    or(isNull(tickets.claimedBy), eq(tickets.claimedBy, claimer.id)),
                ),
            )
            .returning()
            .get();
        if (!claimed)
            return { success: false, message: 'Otro miembro ya ha reclamado este ticket.' };

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

        db.transaction((tx) => {
            const current = tx.select().from(tickets).where(eq(tickets.id, ticket.id)).get();
            if (!current || !['open', 'closed'].includes(current.status))
                throw new Error('Ticket is not active');
            if (current.status === 'closed') {
                const occupied = tx
                    .select({ value: count() })
                    .from(tickets)
                    .where(
                        and(
                            eq(tickets.userId, ticket.userId),
                            inArray(tickets.status, ['open', 'creating', 'creation_failed']),
                        ),
                    )
                    .get();
                if ((occupied?.value ?? 0) >= config.tickets.maxOpenPerUser) {
                    throw new Error('Open ticket limit reached');
                }
            }
            tx.update(tickets)
                .set({
                    status: 'open',
                    closedAt: null,
                    closedBy: null,
                    closeReason: null,
                    deletedAt: null,
                })
                .where(eq(tickets.id, ticket.id))
                .run();
        });

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
        const lines: string[][] = [];
        let before: string | undefined;
        while (true) {
            const messages = await channel.messages.fetch({ limit: 100, before });
            if (messages.size === 0) break;
            lines.unshift(
                [...messages.values()].reverse().map((msg) => {
                    const attachments =
                        msg.attachments.size > 0
                            ? `\n[Attachments]: ${msg.attachments.map((a) => a.url).join(', ')}`
                            : '';
                    return `[${msg.createdAt.toISOString()}] ${msg.author.tag}: ${msg.content || '[no text content]'}${attachments}\n`;
                }),
            );
            const oldest = messages.last()!.id;
            if (oldest === before) throw new Error('Transcript pagination did not advance');
            before = oldest;
            if (messages.size < 100) break;
        }
        return (
            `Transcript for ${channel.name}\nGenerated at ${new Date().toISOString()}\n\n` +
            lines.flat().join('')
        );
    }

    async recoverIncompleteTickets(guild: Guild): Promise<void> {
        const incomplete = db
            .select()
            .from(tickets)
            .where(
                and(
                    eq(tickets.guildId, guild.id),
                    inArray(tickets.status, ['creating', 'creation_failed']),
                ),
            )
            .all();
        for (const ticket of incomplete) {
            if (!this.creating.has(ticket.id)) await this.cleanupIncompleteTicket(ticket, guild);
        }
    }

    private async cleanupIncompleteTicket(
        ticket: TicketRecord,
        guild: Guild,
        knownChannel?: TextChannel,
    ) {
        try {
            // The topic also finds a channel when Discord accepted create but the response was lost.
            const channels = knownChannel
                ? [knownChannel]
                : [...(await guild.channels.fetch()).values()];
            const channel = channels.find(
                (candidate) =>
                    candidate &&
                    (candidate.id === ticket.channelId ||
                        ('topic' in candidate &&
                            candidate.topic === `snoojote-ticket:${ticket.id}`)),
            );
            if (channel) await channel.delete('Incomplete ticket creation rollback');
            await db.delete(tickets).where(eq(tickets.id, ticket.id));
        } catch (error) {
            await db
                .update(tickets)
                .set({ status: 'creation_failed' })
                .where(eq(tickets.id, ticket.id));
            logger.error('Incomplete ticket requires recovery', {
                ticketId: ticket.id,
                guildId: guild.id,
                error,
            });
        }
    }

    private async requireTicket(channel: TextChannel): Promise<TicketRecord> {
        const ticket = await this.getTicketByChannel(channel.id);
        if (!ticket || !['open', 'closed'].includes(ticket.status)) {
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
