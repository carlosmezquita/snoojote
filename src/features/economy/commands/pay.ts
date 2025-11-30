import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import economyService from '../services/economyService.js';

export const data = new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Transfer points to another user.')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to pay')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('amount')
            .setDescription('The amount to pay')
            .setMinValue(1)
            .setRequired(true));

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    if (!target || !amount) return;

    if (target.id === interaction.user.id) {
        await interaction.reply({ content: 'You cannot pay yourself!', ephemeral: true });
        return;
    }

    if (target.bot) {
        await interaction.reply({ content: 'You cannot pay bots!', ephemeral: true });
        return;
    }

    const success = await economyService.transfer(interaction.user.id, target.id, amount);

    if (success) {
        await interaction.reply(`✅ Successfully transferred **${amount}** points to ${target.toString()}.`);
    } else {
        await interaction.reply({ content: '❌ You do not have enough points.', ephemeral: true });
    }
};
