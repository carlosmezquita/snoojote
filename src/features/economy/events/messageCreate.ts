import { Events, type Message } from 'discord.js';
import economyService from '../services/economyService.js';
import questService, { QuestType } from '../services/questService.js';
import { config } from '../../../config.js';

const COOLDOWN_MS = config.economy.messageRewards.cooldownSeconds * 1000;
const cooldowns = new Map<string, number>();

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message) {
        if (message.author.bot || !message.guild) return;

        // General Activity Rewards
        const now = Date.now();
        const lastMessage = cooldowns.get(message.author.id);

        if (!lastMessage || now - lastMessage > COOLDOWN_MS) {
            // Award Pesetas
            const rewardConfig = config.economy.messageRewards;
            const amount =
                Math.floor(Math.random() * (rewardConfig.max - rewardConfig.min + 1)) +
                rewardConfig.min;
            await economyService.addCappedEarning(
                message.author.id,
                'MESSAGE',
                amount,
                rewardConfig.dailyCap,
            );

            // Set cooldown
            cooldowns.set(message.author.id, now);

            // Note: We don't notify user for every message to avoid spam
        }

        // Daily Quest Progress
        // We do this check regardless of cooldown or maybe with cooldown?
        // Let's allow quest progress on every message (or maybe same cooldown?)
        // Applying same cooldown to quest progress prevents spamming 5 messages in 1 second.

        if (!lastMessage || now - lastMessage > COOLDOWN_MS) {
            const userId = message.author.id;
            const channelId = message.channel.id;
            if (questService.isExcludedQuestChannel(channelId)) return;

            // Check if user has a quest related to messages
            const quest = await economyService.getDailyQuest(userId, message.client as any);

            if (quest && !quest.isCompleted && quest.type === QuestType.MESSAGE_COUNT) {
                // Check if channel matches (if strictly enforced) logic in updateQuestProgress handles targetId check
                const updatedQuest = await economyService.updateQuestProgress(
                    userId,
                    QuestType.MESSAGE_COUNT,
                    1,
                    channelId,
                );

                if (updatedQuest && updatedQuest.isCompleted) {
                    await message.reply({
                        content: `🎉 **Tarea completada.** ${updatedQuest.description}\nUsa \`/daily\` para reclamar tu recompensa.`,
                    });
                }
            }
        }
    },
};
