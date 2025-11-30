import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import economyService from '../services/economyService.js';

export const data = new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your or another user\'s balance.')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to check')
            .setRequired(false));

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const target = interaction.options.getUser('user') || interaction.user;
    const balance = await economyService.getBalance(target.id);

    const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle(`${target.username}'s Balance`)
        .setDescription(`💰 **${balance}** points`)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
};
