import { Events, type Message } from 'discord.js';
import { sqlite } from '../../../database/db.js';
import economy from '../services/economyService.js';
import quests, { QuestType } from '../services/questService.js';
import streaks from '../../streaks/services/StreakService.js';
import { config } from '../../../config.js';

export function applyMessage(message: Message) {
    const content = message.content.trim();
    if (!message.guildId || message.author.bot || !content) return;
    const earns = !quests.isExcludedQuestChannel(message.channelId);
    const checksIn = config.streaks.channelIds.includes(message.channelId) && content.length >= 10;
    if (!earns && !checksIn) return;
    const guild = message.guildId;
    const user = message.author.id;
    const date = message.createdAt;
    const time = date.getTime();
    const reward = config.economy.messageRewards;
    return sqlite
        .transaction(() => {
            const receipt = sqlite.run(
                'INSERT INTO message_reward_receipts(message_id,guild_id,user_id,sent_at,reward_eligible) VALUES(?,?,?,?,0) ON CONFLICT(message_id) DO NOTHING',
                [message.id, guild, user, time],
            );
            if (!receipt.changes) return;
            const latest = earns
                ? sqlite
                      .query<{ sent_at: number }, [string, string]>(
                          'SELECT sent_at FROM message_reward_receipts WHERE guild_id=? AND user_id=? AND reward_eligible=1 ORDER BY sent_at DESC LIMIT 1',
                      )
                      .get(guild, user)
                : null;
            let completion: string | undefined;
            if (earns && (!latest || time - latest.sent_at >= reward.cooldownSeconds * 1000)) {
                sqlite.run(
                    'UPDATE message_reward_receipts SET reward_eligible=1 WHERE message_id=?',
                    [message.id],
                );
                const amount =
                    Math.floor(Math.random() * (reward.max - reward.min + 1)) + reward.min;
                economy.addCappedEarningSync(user, 'MESSAGE', amount, reward.dailyCap, date);
                const quest = economy.getDailyQuestSync(user, message.client, date);
                if (quest.type === QuestType.MESSAGE_COUNT && !quest.isCompleted) {
                    const updated = economy.updateQuestProgressSync(
                        user,
                        QuestType.MESSAGE_COUNT,
                        1,
                        message.channelId,
                        date,
                    );
                    if (updated?.isCompleted) completion = updated.description;
                }
            }
            return { completion, streak: checksIn ? streaks.recordCheckIn(user, date) : null };
        })
        .immediate();
}

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message) {
        const result = applyMessage(message);
        if (!result) return;
        await Promise.all([
            streaks.notifyCheckIn(message, message.client, result.streak),
            result.completion &&
                message.reply({
                    content: `🎉 **Tarea completada.** ${result.completion}\nUsa \`/daily\` para reclamar tu recompensa.`,
                    allowedMentions: { parse: [], repliedUser: false },
                }),
        ]);
    },
};
