import { Events, Interaction, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import ticketService from '../services/ticketService.js';

export const name = Events.InteractionCreate;
export const once = false;

export const execute = async (interaction: Interaction, client: DiscordBot) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'create_ticket') {
        if (!interaction.guild) return;

        await interaction.deferReply({ ephemeral: true });

        try {
            const channel = await ticketService.createTicket(interaction.user, interaction.guild);
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

    if (interaction.customId === 'close_ticket') {
        if (!interaction.channel || !interaction.channel.isTextBased()) return;

        await interaction.reply({ content: "Cerrando ticket...", ephemeral: true });

        try {
            await ticketService.closeTicket(interaction.channel as TextChannel, interaction.user);
        } catch (error) {
            client.logger.error(`Ticket Close Error: ${error}`);
        }
    }
};
