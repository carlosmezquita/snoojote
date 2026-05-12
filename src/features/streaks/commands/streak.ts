import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import streakService from '../services/StreakService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';
import { getDailyReward, MILESTONE_BONUSES } from '../services/streakRules.js';

export const data = new SlashCommandBuilder()
    .setName('streak')
    .setDescription("Check your or another user's streak.")
    .addUserOption((option) =>
        option.setName('user').setDescription('The user to check').setRequired(false),
    );

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const target = interaction.options.getUser('user') || interaction.user;
    const userStreak = await streakService.getUserStreak(target.id);

    if (!userStreak) {
        await interaction.reply({
            content: `${target.username} does not have an active streak yet.`,
            ephemeral: true,
        });
        return;
    }

    const freezeCount = await streakService.getStreakFreezeCount(target.id);
    const currentStreak = userStreak.streak;
    const nextMilestone = Object.keys(MILESTONE_BONUSES)
        .map(Number)
        .sort((a, b) => a - b)
        .find((milestone) => milestone > currentStreak);
    const milestoneLine = nextMilestone
        ? `Next Milestone: **${currentStreak}/${nextMilestone}** days`
        : 'Next Milestone: **All milestones reached**';

    const embed = createEmbed(
        `🔥 ${target.username}'s Streak`,
        `Current Streak: **${currentStreak}** days\nHighest Streak: **${userStreak.highestStreak || currentStreak}** days\nDaily Reward: **${getDailyReward(currentStreak)} ₧**\nStreak Freezes: **${freezeCount}**\n${milestoneLine}`,
        Colors.Warning,
    ).setTimestamp();

    await interaction.reply({ embeds: [embed] });
};
