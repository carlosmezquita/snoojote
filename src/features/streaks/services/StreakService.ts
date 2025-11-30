import { Message, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';

const BOT_CHANNEL_ID = config.channels.bot;

export class StreakService {
    async handleStreak(message: Message, client: DiscordBot) {
        const userId = message.author.id;
        const now = new Date();

        const streakDate = new Date(now);
        if (streakDate.getHours() < 14) {
            streakDate.setDate(streakDate.getDate() - 1);
        }
        streakDate.setHours(0, 0, 0, 0);
        const todayUnix = Math.floor(streakDate.getTime() / 1000);

        try {
            const userStreak = await client.db.get<{ user_id: string, streak: number, last_streak_date: string }>(
                'SELECT * FROM streaks WHERE user_id = ?',
                [userId]
            );

            if (userStreak) {
                const lastDateUnix = userStreak.last_streak_date ? parseInt(userStreak.last_streak_date) : 0;

                if (todayUnix === lastDateUnix) {
                    return;
                }

                const diff = todayUnix - lastDateUnix;

                let newStreak = 1;
                let messageContent = '';

                if (diff <= 90000) { // Allow some slack
                    newStreak = userStreak.streak + 1;
                    messageContent = `La racha actual de ${message.author.toString()} es de ${newStreak} días.`;
                    await message.react('🔥');
                } else {
                    newStreak = 1;
                    messageContent = `${message.author.toString()} ha empezado una nueva racha.`;
                }

                await client.db.run(
                    'UPDATE streaks SET streak = ?, last_streak_date = ? WHERE user_id = ?',
                    [newStreak, todayUnix.toString(), userId]
                );

                const botChannel = client.channels.cache.get(BOT_CHANNEL_ID) as TextChannel;
                if (botChannel) {
                    await botChannel.send({ content: messageContent });
                }

            } else {
                // New user
                await client.db.run(
                    'INSERT INTO streaks (user_id, streak, last_streak_date) VALUES (?, ?, ?)',
                    [userId, 1, todayUnix.toString()]
                );

                const botChannel = client.channels.cache.get(BOT_CHANNEL_ID) as TextChannel;
                if (botChannel) {
                    await botChannel.send({
                        content: `¡Hola ${message.author.toString()}!\n\nHas empezado tu primera racha.\nPara mantenerla debes enviar un 'spaincraft' diario.\n\n¡Sigue así!`
                    });
                }
            }

        } catch (error) {
            client.logger.error(`Error handling streak for ${userId}: ${error}`);
        }
    }
}

export default new StreakService();
