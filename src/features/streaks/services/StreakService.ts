import { Message, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import db from '../../../database/db.js';
import { streaks } from '../../../database/schema.js';
import { eq } from 'drizzle-orm';
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
            const userStreak = await db.select()
                .from(streaks)
                .where(eq(streaks.userId, userId))
                .get();

            if (userStreak) {
                const lastDateUnix = userStreak.lastStreakDate ? parseInt(userStreak.lastStreakDate) : 0;

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

                await db.update(streaks)
                    .set({
                        streak: newStreak,
                        lastStreakDate: todayUnix.toString()
                    })
                    .where(eq(streaks.userId, userId));

                const botChannel = client.channels.cache.get(BOT_CHANNEL_ID) as TextChannel;
                if (botChannel) {
                    await botChannel.send({ content: messageContent });
                }

            } else {
                // New user
                await db.insert(streaks).values({
                    userId,
                    streak: 1,
                    lastStreakDate: todayUnix.toString()
                });

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
