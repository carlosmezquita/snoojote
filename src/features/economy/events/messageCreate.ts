import { Events, Message, ChannelType } from 'discord.js';
import economyService from '../services/economyService.js';
import { QuestType } from '../services/questService.js';

const COOLDOWN_MS = 60 * 1000; // 1 minute
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
            const amount = Math.floor(Math.random() * 5) + 1; // 1-5 Pesetas
            await economyService.addBalance(message.author.id, amount);

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

            // Check if user has a quest related to messages
            const quest = await economyService.getDailyQuest(userId, message.client as any);

            if (quest && !quest.isCompleted && quest.type === QuestType.MESSAGE_COUNT) {
                // Check if channel matches (if strictly enforced) logic in updateQuestProgress handles targetId check
                const updatedQuest = await economyService.updateQuestProgress(userId, QuestType.MESSAGE_COUNT, 1, channelId);

                if (updatedQuest && updatedQuest.isCompleted) {
                    await message.reply({ content: `🎉 **Quest Completed!** ${updatedQuest.description}\nUse \`/daily\` to claim your reward!` });
                }
            }
        }
    }
};
