import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import economyService from '../services/economyService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Check your daily quest or claim your reward.');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    // 1. Get current quest (this also ensures one exists for the day)
    const quest = await economyService.getDailyQuest(interaction.user.id, client);

    // 2. Try to claim (checks 24h cooldown AND completion)
    // We do a check first to see if we SHOULD claim or just show status

    // If completed and not claimed recently (we rely on claimDaily to check lastDaily)
    // Actually, claimDaily checks if quest is completed.

    // Let's try to claim if it looks completed. If not, claimDaily will fail with message.
    // However, if we just want to VIEW status, maybe we shouldn't auto-claim?
    // User requested "/daily" to claim reward AND/OR see quest.
    // Let's try to claim. If it fails because "not completed", show progress.
    // If it fails because "already claimed", show cooldown.

    const claimResult = await economyService.claimDaily(interaction.user.id);

    if (claimResult.success) {
        const embed = createEmbed(
            'Daily Reward Claimed!',
            `🎉 You have completed your daily quest:\n**${quest.description}**\n\nReward: **${claimResult.reward}** ₧`,
            Colors.Success
        );
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    // Handling Failure Cases

    // Case 1: Already claimed
    if (claimResult.message.includes('Already claimed')) {
        const embed = createEmbed(
            'Daily Reward',
            `You have already claimed your reward for tody.\n${claimResult.message}`,
            Colors.Warning
        );
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    // Case 2: Not completed (or other error)
    // Show Quest Status
    const percentage = Math.min(100, Math.floor((quest.current / quest.goal) * 100));
    const progressBar = createProgressBar(quest.current, quest.goal);

    const embed = createEmbed(
        'Daily Quest',
        `**Quest**: ${quest.description}\n\n**Progress**: ${quest.current}/${quest.goal}\n${progressBar} ${percentage}%\n\nComplete this quest to claim your **250 ₧** daily reward!`,
        Colors.Info
    );

    await interaction.reply({ embeds: [embed], ephemeral: true });
};

function createProgressBar(current: number, goal: number, size: number = 10): string {
    const progress = Math.min(current / goal, 1);
    const filled = Math.floor(progress * size);
    const empty = size - filled;

    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}
