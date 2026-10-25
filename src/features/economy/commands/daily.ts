import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import economyService from '../services/economyService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';
import questService, { QuestType } from '../services/questService.js';
import voiceSessionService from '../services/voiceSessionService.js';
import { applyVoiceMinutes } from '../events/voiceStateUpdate.js';

export const data = new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Consulta tu tarea diaria o reclama tu recompensa.');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    await interaction.deferReply({ ephemeral: true });
    // 1. Get current quest (this also ensures one exists for the day)
    let quest = await economyService.getDailyQuest(interaction.user.id, client);
    await syncActiveVoiceQuestProgress(interaction, quest.type);
    quest = await economyService.getDailyQuest(interaction.user.id, client);
    const currentReward = await economyService.getCurrentDailyReward(interaction.user.id);

    const claimResult = await economyService.claimDaily(interaction.user.id);

    if (claimResult.success) {
        const embed = createEmbed(
            'Recompensa diaria reclamada',
            `🎉 Has completado tu tarea diaria:\n**${quest.description}**\n\nRecompensa: **${claimResult.reward}** ₧`,
            Colors.Success,
        );
        await interaction.editReply({ embeds: [embed] });
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
        await interaction.editReply({ embeds: [embed] });
        return;
    }

    // Case 2: Not completed (or other error)
    // Show Quest Status
    const percentage = Math.min(100, Math.floor((quest.current / quest.goal) * 100));
    const progressBar = createProgressBar(quest.current, quest.goal);

    const embed = createEmbed(
        'Tarea diaria',
        `**Tarea**: ${quest.description}\n\n**Progreso**: ${quest.current}/${quest.goal}\n${progressBar} ${percentage}%\n\n**Cómo completarla**: ${questService.getGuidelines(quest)}\n\nCompleta esta tarea para reclamar tu recompensa diaria de **${currentReward} ₧**.`,
        Colors.Info,
    );

    await interaction.editReply({ embeds: [embed] });
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

    for (const elapsed of voiceSessionService.collectDated(interaction.user.id)) {
        await applyVoiceMinutes(
            interaction.user.id,
            elapsed.channelId,
            elapsed.minutes,
            member.voice,
            elapsed.earnedAt,
        );
    }
}

function createProgressBar(current: number, goal: number, size: number = 10): string {
    const progress = Math.min(current / goal, 1);
    const filled = Math.floor(progress * size);
    const empty = size - filled;

    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}
