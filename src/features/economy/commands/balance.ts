import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import economyService from '../services/economyService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Consulta tu saldo o el de otro usuario.')
    .addUserOption((option) =>
        option.setName('user').setDescription('Usuario que quieres consultar').setRequired(false),
    );

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const target = interaction.options.getUser('user') || interaction.user;
    const balance = await economyService.getBalance(target.id);

    const embed = createEmbed(
        `Cartera de ${target.username}`,
        `💰 **${balance}** ₧ (Pesetas)`,
        Colors.Success,
    ).setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
};
