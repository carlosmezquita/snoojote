import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    type TextChannel,
} from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';

export const data = new SlashCommandBuilder()
    .setName('rplacebutton')
    .setDescription('Send the rPlace role button (Admin only).');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: 'No tienes permiso.', ephemeral: true });
        return;
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('give_rplace2023_role')
            .setLabel('r/Place 2023')
            .setStyle(ButtonStyle.Primary),
    );

    const channel = interaction.channel as TextChannel;
    if (channel) {
        await channel.send({
            content: 'Haz clic para obtener el rol de r/Place 2023',
            components: [row],
        });
        await interaction.reply({ content: 'Botón enviado.', ephemeral: true });
    }
};
