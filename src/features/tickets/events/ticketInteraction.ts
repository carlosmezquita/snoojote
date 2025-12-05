import { Events, Interaction, TextChannel, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ModalActionRowComponentBuilder, ComponentType } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import ticketService from '../services/ticketService.js';
import { ticketOptions } from '../config/options/index.js';

export const name = Events.InteractionCreate;
export const once = false;

export const execute = async (interaction: Interaction, client: DiscordBot) => {
    if (interaction.isButton()) {
        if (!interaction.guild) return;
        const customId = interaction.customId;

        // Handle Close Ticket
        if (customId === 'close_ticket') {
            if (!interaction.channel || !interaction.channel.isTextBased()) return;

            await interaction.reply({ content: "Cerrando ticket...", ephemeral: true });

            try {
                await ticketService.closeTicket(interaction.channel as TextChannel, interaction.user);
            } catch (error) {
                client.logger.error(`Ticket Close Error: ${error}`);
            }
            return;
        }

        // Handle Ticket Category Buttons
        const option = ticketOptions[customId];
        if (option && option.modal) {
            await interaction.showModal(option.modal);
            return;
        }

    } else if (interaction.isModalSubmit()) {
        if (!interaction.guild) return;

        // Check if it's one of our ticket modals
        // The customIds are like "ticket_modal_general", "ticket_modal_spam", etc.
        if (interaction.customId.startsWith('ticket_modal_')) {
            const optionId = interaction.customId.replace('ticket_modal_', '');
            const option = ticketOptions[optionId];

            if (option) {
                await interaction.deferReply({ ephemeral: true });

                const modalData: { question: string, answer: string }[] = [];

                // Iterate over the submitted fields
                interaction.fields.fields.forEach((field) => {
                    if (field.type === ComponentType.TextInput) {
                        let label = field.customId;

                        // Try to find the label from the modal config
                        const components = option.modal?.components;
                        if (components) {
                            for (const row of components) {
                                // Cast to ActionRowBuilder<ModalActionRowComponentBuilder> to access components
                                const actionRow = row as ActionRowBuilder<ModalActionRowComponentBuilder>;
                                const input = actionRow.components[0];

                                // Check if input exists and matches customId
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
                        await interaction.editReply("Ya tienes un ticket abierto.");
                    }
                } catch (error) {
                    client.logger.error(`Ticket Create Error: ${error}`);
                    await interaction.editReply("Hubo un error al crear el ticket.");
                }
            }
        }
    }
};
