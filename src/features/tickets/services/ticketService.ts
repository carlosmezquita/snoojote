import { ChannelType, PermissionFlagsBits, Guild, User, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle, OverwriteType } from 'discord.js';
import { TicketOptionConfig } from '../config/TicketConfig.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { eq, and } from 'drizzle-orm';
import { config } from '../../../config.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';

const TICKET_CATEGORY_ID = config.channels.ticketCategory;
const SUPPORT_ROLE_ID = config.roles.support;

export class TicketService {
    async createTicket(user: User, guild: Guild, option: TicketOptionConfig, modalData: { question: string, answer: string }[]): Promise<TextChannel | null> {
        // Check if user already has a ticket
        const existingTicket = await db.select()
            .from(tickets)
            .where(and(eq(tickets.userId, user.id), eq(tickets.status, 'open')))
            .get();

        if (existingTicket) {
            return null; // User already has an open ticket
        }

        try {
            const channelName = `${option.channelPrefix}${user.username.substring(0, 10)}`;

            const permissionOverwrites: any[] = [
                {
                    id: guild.id,
                    type: OverwriteType.Role,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: user.id,
                    type: OverwriteType.Member,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
                },
                {
                    id: guild.client.user!.id,
                    type: OverwriteType.Member,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                }
            ];

            // Add admin roles
            if (option.adminRoles) {
                for (const roleId of option.adminRoles) {
                    if (roleId) {
                        permissionOverwrites.push({
                            id: roleId,
                            type: OverwriteType.Role,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                        });
                    }
                }
            }

            const channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: option.categoryId || undefined,
                permissionOverwrites: permissionOverwrites
            });

            await db.insert(tickets).values({
                channelId: channel.id,
                userId: user.id,
                status: 'open'
            });

            const responseTimeService = (await import('./responseTimeService.js')).default;
            const estimate = await responseTimeService.getEstimatedWaitTime(guild);

            const embed = createEmbed(
                option.openMessage || `Ticket de ${user.username}`,
                option.ticketWelcomeMessage + "\n\n" +
                `**⏱️ Estimated Response Time:** ${estimate}\n\n` +
                modalData.map(d => `**${d.question}**\n${d.answer}`).join("\n\n"),
                Colors.Info
            );

            if (option.thumbnailUrl) {
                embed.setThumbnail(option.thumbnailUrl);
            }
            if (option.imageUrl) {
                embed.setImage(option.imageUrl);
            }

            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Cerrar Ticket')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒')
                );

            let content = `<@${user.id}>`;

            if (option.pingHere) content += " @here";
            if (option.pingEveryone) content += " @everyone";
            if (option.pingCustomRoleId) {
                content += ` <@&${option.pingCustomRoleId}>`;
            }

            await channel.send({ content: content, embeds: [embed], components: [row] });

            if (option.enableDmOnOpen) {
                try {
                    const dmEmbed = createEmbed(
                        "Ticket Created",
                        `Your ticket has been created in **${guild.name}**.\nChannel: ${channel.toString()}`,
                        Colors.Success
                    );
                    await user.send({ embeds: [dmEmbed] });
                } catch (err) {
                    // Ignore if DMs are closed
                }
            }

            return channel;
        } catch (error) {
            console.error("Error creating ticket:", error);
            throw error;
        }
    }

    async closeTicket(channel: TextChannel, closer: User): Promise<void> {
        await db.update(tickets)
            .set({ status: 'closed' })
            .where(eq(tickets.channelId, channel.id));

        const transcript = await this.generateTranscript(channel);

        await channel.send({
            content: `Ticket cerrado por ${closer.toString()}. El canal se borrará en 5 segundos.`,
            files: [
                {
                    attachment: Buffer.from(transcript, 'utf-8'),
                    name: `transcript-${channel.name}.txt`
                }
            ]
        });

        setTimeout(async () => {
            await channel.delete().catch(() => { });
        }, 5000);
    }

    async generateTranscript(channel: TextChannel): Promise<string> {
        const messages = await channel.messages.fetch({ limit: 100 });
        const sortedMessages = messages.reverse();

        let transcript = `Transcript for ${channel.name}\nGenerated at ${new Date().toISOString()}\n\n`;

        sortedMessages.forEach(msg => {
            const time = msg.createdAt.toISOString();
            const author = msg.author.tag;
            const content = msg.content;
            transcript += `[${time}] ${author}: ${content}\n`;
            if (msg.attachments.size > 0) {
                transcript += `[Attachments]: ${msg.attachments.map(a => a.url).join(', ')}\n`;
            }
        });

        return transcript;
    }
}

export default new TicketService();
