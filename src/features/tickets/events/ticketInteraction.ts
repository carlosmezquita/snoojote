import {
    ActionRowBuilder,
    Events,
    type GuildMember,
    type Interaction,
    ModalBuilder,
    type TextChannel,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import ticketService from '../services/ticketService.js';
import { ticketOptions } from '../config/options/index.js';
import { isTicketStaff } from '../utils/ticketStaff.js';
import { readTicketModal } from '../services/ticketModal.js';
import { TicketAttachmentError } from '../services/ticketAttachments.js';

export const name = Events.InteractionCreate;
export const once = false;

export const execute = async (interaction: Interaction, client: DiscordBot) => {
    if (interaction.isButton()) {
        if (!interaction.guild) return;
        const customId = interaction.customId;

        if (customId === 'close_ticket') {
            if (!interaction.channel || !interaction.channel.isTextBased()) return;

            const ticket = await ticketService.getTicketByChannel(interaction.channel.id);
            if (!ticket) {
                await interaction.reply({
                    content: 'Este canal no es un ticket activo.',
                    ephemeral: true,
                });
                return;
            }

            const member = await getGuildMember(interaction);
            if (!member || (!isTicketStaff(member) && ticket.userId !== interaction.user.id)) {
                await interaction.reply({
                    content: 'No tienes permiso para cerrar este ticket.',
                    ephemeral: true,
                });
                return;
            }

            await interaction.showModal(closeTicketModal());
            return;
        }

        if (customId === 'reopen_ticket' || customId === 'delete_ticket') {
            if (!interaction.channel || !interaction.channel.isTextBased()) return;

            const member = await getGuildMember(interaction);
            if (!member || !isTicketStaff(member)) {
                await interaction.reply({
                    content: 'No tienes permiso para gestionar este ticket.',
                    ephemeral: true,
                });
                return;
            }

            await interaction.deferReply({ ephemeral: true });
            try {
                if (customId === 'reopen_ticket') {
                    await ticketService.reopenTicket(
                        interaction.channel as TextChannel,
                        interaction.user,
                    );
                    await interaction.editReply('Ticket reabierto.');
                } else {
                    await ticketService.deleteTicket(
                        interaction.channel as TextChannel,
                        interaction.user,
                    );
                    await interaction.editReply('Ticket marcado para eliminación.');
                }
            } catch (error) {
                client.logger.error('Ticket button action failed', {
                    customId,
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    channelId: interaction.channelId,
                    error,
                });
                await interaction.editReply(
                    error instanceof TicketAttachmentError
                        ? error.message
                        : 'No se pudo gestionar el ticket.',
                );
            }
            return;
        }

        const option = ticketOptions[customId];
        if (option && option.modal) {
            await interaction.showModal(option.modal);
            return;
        }
    } else if (interaction.isModalSubmit()) {
        if (!interaction.guild) return;

        if (interaction.customId === 'close_ticket_modal') {
            if (!interaction.channel || !interaction.channel.isTextBased()) return;

            await interaction.deferReply({ ephemeral: true });
            const ticket = await ticketService.getTicketByChannel(interaction.channel.id);
            const member = await getGuildMember(interaction);
            if (
                !ticket ||
                !member ||
                (!isTicketStaff(member) && ticket.userId !== interaction.user.id)
            ) {
                await interaction.editReply('No tienes permiso para cerrar este ticket.');
                return;
            }

            try {
                const reason =
                    interaction.fields.getTextInputValue('close_reason') || 'No reason provided.';
                await ticketService.closeTicket(
                    interaction.channel as TextChannel,
                    interaction.user,
                    reason,
                );
                await interaction.editReply('Ticket cerrado.');
            } catch (error) {
                client.logger.error('Ticket close action failed', {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    channelId: interaction.channelId,
                    error,
                });
                await interaction.editReply(
                    error instanceof TicketAttachmentError
                        ? error.message
                        : 'No se pudo cerrar el ticket.',
                );
            }
            return;
        }

        if (interaction.customId.startsWith('ticket_modal_')) {
            const optionId = interaction.customId.replace('ticket_modal_', '');
            const option = ticketOptions[optionId];

            if (option) {
                await interaction.deferReply({ ephemeral: true });

                try {
                    const submission = readTicketModal(interaction.fields, option.modal);
                    const channel = await ticketService.createTicket(
                        interaction.user,
                        interaction.guild!,
                        option,
                        submission.answers,
                        submission.attachments,
                    );
                    if (channel) {
                        client.logger.info('Ticket created from interaction', {
                            userId: interaction.user.id,
                            guildId: interaction.guildId,
                            channelId: channel.id,
                            optionId,
                        });
                        await interaction.editReply(`Ticket creado: ${channel.toString()}`);
                    } else {
                        client.logger.info('Ticket creation rejected by open ticket limit', {
                            userId: interaction.user.id,
                            guildId: interaction.guildId,
                            optionId,
                            maxOpenPerUser: config.tickets.maxOpenPerUser,
                        });
                        await interaction.editReply(
                            `Has alcanzado el límite de ${config.tickets.maxOpenPerUser} tickets abiertos.`,
                        );
                    }
                } catch (error) {
                    client.logger.error('Ticket creation action failed', {
                        userId: interaction.user.id,
                        guildId: interaction.guildId,
                        optionId,
                        error,
                    });
                    await interaction.editReply(
                        error instanceof TicketAttachmentError
                            ? error.message
                            : 'Hubo un error al crear el ticket.',
                    );
                }
            }
        }
    }
};

function closeTicketModal() {
    const modal = new ModalBuilder()
        .setCustomId('close_ticket_modal')
        .setTitle('Confirmar cierre de solicitud');

    const reasonInput = new TextInputBuilder()
        .setCustomId('close_reason')
        .setLabel('Motivo del cierre (opcional)')
        .setPlaceholder('Este formulario cierra el ticket. Para pedir ayuda, escribe en el canal.')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1024)
        .setRequired(false);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    return modal;
}

async function getGuildMember(interaction: Interaction): Promise<GuildMember | null> {
    if (!interaction.guild) return null;
    return await interaction.guild.members
        .fetch({ user: interaction.user.id, force: true })
        .catch(() => null);
}
