import { ChannelType, PermissionFlagsBits, Guild, User, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import db from '../../../database/index.js';

import { config } from '../../../config.js';

const TICKET_CATEGORY_ID = config.channels.ticketCategory;
const SUPPORT_ROLE_ID = config.roles.support;

export class TicketService {
    async createTicket(user: User, guild: Guild): Promise<TextChannel | null> {
        // Check if user already has a ticket
        const existingTicket = await db.get<{ channel_id: string }>('SELECT channel_id FROM tickets WHERE user_id = ? AND status = ?', [user.id, 'open']);
        if (existingTicket) {
            return null; // User already has an open ticket
        }

        try {
            const channelName = `ticket-${user.username.substring(0, 10)}`;
            const channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: TICKET_CATEGORY_ID || undefined,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
                    },
                    {
                        id: SUPPORT_ROLE_ID || guild.roles.everyone.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    },
                    {
                        id: guild.client.user!.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    }
                ]
            });

            await db.run('INSERT INTO tickets (channel_id, user_id, status) VALUES (?, ?, ?)', [channel.id, user.id, 'open']);

            const embed = new EmbedBuilder()
                .setTitle(`Ticket de ${user.username}`)
                .setDescription("Un miembro del equipo de soporte te atenderá pronto.\nPara cerrar el ticket, pulsa el botón de abajo.")
                .setColor(0x5865F2);

            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Cerrar Ticket')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒')
                );

            await channel.send({ content: `<@${user.id}> Bienvenido.`, embeds: [embed], components: [row] });

            return channel;
        } catch (error) {
            console.error("Error creating ticket:", error);
            throw error;
        }
    }

    async closeTicket(channel: TextChannel, closer: User): Promise<void> {
        await db.run('UPDATE tickets SET status = ? WHERE channel_id = ?', ['closed', channel.id]);

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
