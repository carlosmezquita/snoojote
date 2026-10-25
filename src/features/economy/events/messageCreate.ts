import { Events, type Message } from 'discord.js';
import economyService from '../services/economyService.js';
import questService, { QuestType } from '../services/questService.js';
import { config } from '../../../config.js';
import { type DiscordBot } from '../../../core/client.js';
import { Cooldown } from '../../../shared/services/Cooldown.js';

const cooldowns = new Cooldown();
export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message) {
        if (
            message.author.bot ||
            !message.guild ||
            !message.content.trim() ||
            questService.isExcludedQuestChannel(message.channelId)
        )
            return;
        const reward = config.economy.messageRewards;
        if (
            !cooldowns.acquire(
                `${message.guildId}:${message.author.id}`,
                reward.cooldownSeconds * 1000,
            )
        )
            return;
        const amount = Math.floor(Math.random() * (reward.max - reward.min + 1)) + reward.min;
        await economyService.addCappedEarning(
            message.author.id,
            'MESSAGE',
            amount,
            reward.dailyCap,
        );
        const quest = await economyService.getDailyQuest(
            message.author.id,
            message.client as DiscordBot,
        );
        if (quest.type !== QuestType.MESSAGE_COUNT || quest.isCompleted) return;
        const updated = await economyService.updateQuestProgress(
            message.author.id,
            QuestType.MESSAGE_COUNT,
            1,
            message.channelId,
        );
        if (updated?.isCompleted)
            await message.reply({
                content: `🎉 **Tarea completada.** ${updated.description}\nUsa \`/daily\` para reclamar tu recompensa.`,
                allowedMentions: { parse: [], repliedUser: false },
            });
    },
};
