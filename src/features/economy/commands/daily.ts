import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import economyService from '../services/economyService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';
import questService, { QuestType } from '../services/questService.js';
import voiceSessionService from '../services/voiceSessionService.js';
import { applyVoiceMinutes } from '../events/voiceStateUpdate.js';
import { config } from '../../../config.js';

export const data = new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Consulta tu tarea diaria o reclama tu recompensa.');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    // 1. Get current quest (this also ensures one exists for the day)
    let quest = await economyService.getDailyQuest(interaction.user.id, client);
    await syncActiveVoiceQuestProgress(interaction, quest.type);
    quest = await economyService.getDailyQuest(interaction.user.id, client);
    const currentReward = await economyService.getCurrentDailyReward(interaction.user.id);

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
            'Recompensa diaria reclamada',
            `🎉 Has completado tu tarea diaria:\n**${quest.description}**\n\nRecompensa: **${claimResult.reward}** ₧`,
            Colors.Success,
        );
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    // Handling Failure Cases

    // Case 1: Already claimed
    if (claimResult.message.includes('Ya reclamada')) {
        const embed = createEmbed(
            'Recompensa diaria',
            `Ya has reclamado tu recompensa de hoy.\n${claimResult.message}`,
            Colors.Warning,
        );
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    // Case 2: Not completed (or other error)
    // Show Quest Status
    const percentage = Math.min(100, Math.floor((quest.current / quest.goal) * 100));
    const progressBar = createProgressBar(quest.current, quest.goal);
    const excludedChannels = config.economy.questExcludedChannelIds;
    const excludedLine =
        excludedChannels.length > 0
            ? `\n\n**Canales excluidos**: ${excludedChannels.map((id) => `<#${id}>`).join(', ')}`
            : '';

    const embed = createEmbed(
        'Tarea diaria',
        `**Tarea**: ${quest.description}\n\n**Progreso**: ${quest.current}/${quest.goal}\n${progressBar} ${percentage}%\n\n**Cómo completarla**: ${questService.getGuidelines(quest)}${excludedLine}\n\nCompleta esta tarea para reclamar tu recompensa diaria de **${currentReward} ₧**.`,
        Colors.Info,
    );

    await interaction.reply({ embeds: [embed], ephemeral: true });
};

async function syncActiveVoiceQuestProgress(
    interaction: ChatInputCommandInteraction,
    questType: QuestType,
): Promise<void> {
    if (questType !== QuestType.VOICE_TIME || !interaction.guild) return;

    const member =
        interaction.guild.members.cache.get(interaction.user.id) ??
        (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
    if (!member) return;

    const channelId = member.voice.channelId;
    if (!channelId || questService.isExcludedQuestChannel(channelId)) return;

    const activeSession = voiceSessionService.getSession(interaction.user.id);
    if (!activeSession) {
        voiceSessionService.start(interaction.user.id, channelId);
        return;
    }

    const elapsed = voiceSessionService.collectElapsed(interaction.user.id);
    if (elapsed?.minutes) {
        await applyVoiceMinutes(
            interaction.user.id,
            elapsed.channelId,
            elapsed.minutes,
            member.voice,
        );
    }
}

function createProgressBar(current: number, goal: number, size: number = 10): string {
    const progress = Math.min(current / goal, 1);
    const filled = Math.floor(progress * size);
    const empty = size - filled;

    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}
