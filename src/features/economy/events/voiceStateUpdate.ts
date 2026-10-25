import { Events, type VoiceState } from 'discord.js';
import economyService from '../services/economyService.js';
import questService, { QuestType } from '../services/questService.js';
import { config } from '../../../config.js';
import voiceSessionService from '../services/voiceSessionService.js';
import { getSpainDateKey } from '../../streaks/services/streakRules.js';
import { DMService } from '../../../shared/services/DMService.js';

export default {
    name: Events.VoiceStateUpdate,
    once: false,
    async execute(oldState: VoiceState, newState: VoiceState) {
        const userId = newState.member?.id || oldState.member?.id;
        const member = newState.member ?? oldState.member;
        if (!userId || member?.user.bot) return;

        const now = Date.now();
        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;
        const isJoining = !!newChannelId && !oldChannelId;
        const isLeaving = !newChannelId && !!oldChannelId;
        const isSwitching = !!oldChannelId && !!newChannelId && oldChannelId !== newChannelId;

        if (isJoining) {
            if (!questService.isExcludedQuestChannel(newChannelId)) {
                voiceSessionService.start(userId, newChannelId, now);
            }
            return;
        }

        if (isSwitching || isLeaving) {
            const elapsed = voiceSessionService.collectDated(userId, now, true);
            // Settle the session before awaiting SQL/Discord so another gateway event cannot lose it.
            if (newChannelId && !questService.isExcludedQuestChannel(newChannelId))
                voiceSessionService.start(userId, newChannelId, now);
            for (const slice of elapsed)
                await applyVoiceMinutes(
                    userId,
                    slice.channelId,
                    slice.minutes,
                    newState,
                    slice.earnedAt,
                );
        }
    },
};

export async function applyVoiceMinutes(
    userId: string,
    channelId: string | null | undefined,
    durationMinutes: number,
    state: VoiceState,
    earnedAt = new Date(),
): Promise<void> {
    if (durationMinutes < 1 || questService.isExcludedQuestChannel(channelId)) return;

    const reward = Math.floor(durationMinutes * config.economy.voiceRewards.perMinute);
    if (reward > 0) {
        await economyService.addCappedEarning(
            userId,
            'VOICE',
            reward,
            config.economy.voiceRewards.dailyCap,
            earnedAt,
        );
    }

    if (getSpainDateKey(earnedAt) !== getSpainDateKey(new Date())) return;
    const quest = await economyService.getDailyQuest(userId, state.client as any);
    if (!quest || quest.isCompleted || quest.type !== QuestType.VOICE_TIME) return;

    const updatedQuest = await economyService.updateQuestProgress(
        userId,
        QuestType.VOICE_TIME,
        durationMinutes,
    );

    if (updatedQuest?.isCompleted) {
        const user = state.member?.user;
        if (!user) return;

        await DMService.sendSuccessWithFallback(
            user,
            'Tarea diaria completada',
            `Tarea diaria completada: **${updatedQuest.description}**\nUsa \`/daily\` para reclamar tu recompensa.`,
        );
    }
}
