import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import streakService from '../services/StreakService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('streak')
    .setDescription('Check your or another user\'s streak.')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to check')
            .setRequired(false));

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const target = interaction.options.getUser('user') || interaction.user;
    const userStreak = await streakService.getUserStreak(target.id);

    if (!userStreak) {
        await interaction.reply({
            content: `${target.username} does not have an active streak yet.`,
            ephemeral: true
        });
        return;
    }

    const embed = createEmbed(
        `🔥 ${target.username}'s Streak`,
        `Current Streak: **${userStreak.streak}** days`,
        Colors.Warning
    ).setTimestamp();

    await interaction.reply({ embeds: [embed] });
};
