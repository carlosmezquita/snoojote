import { Events, type VoiceState } from 'discord.js';
import economyService from '../services/economyService.js';
import { QuestType } from '../services/questService.js';

// Map to store join times: userId -> timestamp
const voiceJoins = new Map<string, number>();

export default {
    name: Events.VoiceStateUpdate,
    once: false,
    async execute(oldState: VoiceState, newState: VoiceState) {
        const userId = newState.member?.id || oldState.member?.id;
        if (!userId || newState.member?.user.bot) return;

        const now = Date.now();

        // User Joined Voice (and wasn't in one before, or switched channels logic can be complex)
        // Simple Logic: If joining a valid channel (not AFK)
        const isJoining = !!newState.channelId && !oldState.channelId;
        const isLeaving = !newState.channelId && !!oldState.channelId;
        // Switching: oldState.channelId && newState.channelId

        if (isJoining) {
            voiceJoins.set(userId, now);
        } else if (isLeaving) {
            const joinTime = voiceJoins.get(userId);
            if (joinTime) {
                const durationMs = now - joinTime;
                const durationMinutes = Math.floor(durationMs / (1000 * 60));

                if (durationMinutes >= 1) {
                    // Award 1 Peseta per minute
                    // Or 10 Pesetas every 10 mins (approx 1 per min)
                    const reward = Math.floor(durationMinutes * 1);
                    if (reward > 0) {
                        await economyService.addBalance(userId, reward);
                    }

                    // Quest Progress
                    const quest = await economyService.getDailyQuest(
                        userId,
                        newState.client as any,
                    );
                    if (quest && !quest.isCompleted && quest.type === QuestType.VOICE_TIME) {
                        await economyService.updateQuestProgress(
                            userId,
                            QuestType.VOICE_TIME,
                            durationMinutes,
                        );
                        // We can't reply to a voice state update, so maybe we rely on /daily to check status
                        // Or send a DM (intrusive)
                        // Or just let it be silent until they check
                    }
                }
                voiceJoins.delete(userId);
            }
        }
    },
};
