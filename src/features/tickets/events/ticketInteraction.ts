import {
    ActionRowBuilder,
    ComponentType,
    Events,
    GuildMember,
    Interaction,
    ModalActionRowComponentBuilder,
    ModalBuilder,
    PermissionFlagsBits,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import ticketService from '../services/ticketService.js';
import { ticketOptions } from '../config/options/index.js';

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
                await interaction.reply({ content: 'Este canal no es un ticket activo.', ephemeral: true });
                return;
            }

            const member = await getGuildMember(interaction);
            if (!member || (!canManageTickets(member) && ticket.userId !== interaction.user.id)) {
                await interaction.reply({ content: 'No tienes permiso para cerrar este ticket.', ephemeral: true });
                return;
            }

            await interaction.showModal(closeTicketModal());
            return;
        }

        if (customId === 'reopen_ticket' || customId === 'delete_ticket') {
            if (!interaction.channel || !interaction.channel.isTextBased()) return;

            const member = await getGuildMember(interaction);
            if (!member || !canManageTickets(member)) {
                await interaction.reply({ content: 'No tienes permiso para gestionar este ticket.', ephemeral: true });
                return;
            }

            await interaction.deferReply({ ephemeral: true });
            try {
                if (customId === 'reopen_ticket') {
                    await ticketService.reopenTicket(interaction.channel as TextChannel, interaction.user);
                    await interaction.editReply('Ticket reabierto.');
                } else {
                    await ticketService.deleteTicket(interaction.channel as TextChannel, interaction.user);
                    await interaction.editReply('Ticket marcado para eliminación.');
                }
            } catch (error) {
                client.logger.error(`Ticket Button Error: ${error}`);
                await interaction.editReply('No se pudo gestionar el ticket.');
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

            try {
                const reason = interaction.fields.getTextInputValue('close_reason') || 'No reason provided.';
                await ticketService.closeTicket(interaction.channel as TextChannel, interaction.user, reason);
                await interaction.editReply('Ticket cerrado.');
            } catch (error) {
                client.logger.error(`Ticket Close Error: ${error}`);
                await interaction.editReply('No se pudo cerrar el ticket.');
            }
            return;
        }

        if (interaction.customId.startsWith('ticket_modal_')) {
            const optionId = interaction.customId.replace('ticket_modal_', '');
            const option = ticketOptions[optionId];

            if (option) {
                await interaction.deferReply({ ephemeral: true });

                const modalData: { question: string, answer: string }[] = [];

                interaction.fields.fields.forEach((field) => {
                    if (field.type === ComponentType.TextInput) {
                        let label = field.customId;

                        const components = option.modal?.components;
                        if (components) {
                            for (const row of components) {
                                const actionRow = row as ActionRowBuilder<ModalActionRowComponentBuilder>;
                                const input = actionRow.components[0];

                                if (input && 'data' in input && input.data.custom_id === field.customId) {
                                    label = input.data.label || field.customId;
                                }
                            }
                        }

                        modalData.push({
                            question: label,
                            answer: field.value
                        });
                    }
                });

                try {
                    const channel = await ticketService.createTicket(interaction.user, interaction.guild!, option, modalData);
                    if (channel) {
                        await interaction.editReply(`Ticket creado: ${channel.toString()}`);
                    } else {
                        await interaction.editReply(`Has alcanzado el límite de ${config.tickets.maxOpenPerUser} tickets abiertos.`);
                    }
                } catch (error) {
                    client.logger.error(`Ticket Create Error: ${error}`);
                    await interaction.editReply("Hubo un error al crear el ticket.");
                }
            }
        }
    }
};

function closeTicketModal() {
    const modal = new ModalBuilder()
        .setCustomId('close_ticket_modal')
        .setTitle('Cerrar Ticket / Close Ticket');

    const reasonInput = new TextInputBuilder()
        .setCustomId('close_reason')
        .setLabel('Motivo / Reason')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1024)
        .setRequired(false);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    return modal;
}

async function getGuildMember(interaction: Interaction): Promise<GuildMember | null> {
    if (!interaction.guild) return null;
    if (interaction.member instanceof GuildMember) return interaction.member;
    return await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

function canManageTickets(member: GuildMember): boolean {
    return member.permissions.has(PermissionFlagsBits.Administrator)
        || member.roles.cache.has(config.roles.mod)
        || member.roles.cache.has(config.roles.support);
}
