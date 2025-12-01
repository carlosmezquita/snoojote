import { Message, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import db from '../../../database/db.js';
import { streaks } from '../../../database/schema.js';
import { eq, desc } from 'drizzle-orm';
import { config } from '../../../config.js';

const BOT_CHANNEL_ID = config.channels.bot;

export class StreakService {
    private readonly STREAK_SLACK_MS = 90000; // 1.5 minutes slack
    private readonly RESET_HOUR = 14; // 2 PM

    async handleStreak(message: Message, client: DiscordBot) {
        const userId = message.author.id;
        const todayUnix = this.getTodayUnix();

        try {
            const userStreak = await db.select()
                .from(streaks)
                .where(eq(streaks.userId, userId))
                .get();

            if (userStreak) {
                await this.updateExistingStreak(message, userStreak, todayUnix, client);
            } else {
                await this.createNewStreak(message, todayUnix, client);
            }

        } catch (error) {
            client.logger.error(`Error handling streak for ${userId}: ${error}`);
        }
    }

    private getTodayUnix(): number {
        const now = new Date();
        const streakDate = new Date(now);

        // If before reset hour, count as previous day
        if (streakDate.getHours() < this.RESET_HOUR) {
            streakDate.setDate(streakDate.getDate() - 1);
        }

        streakDate.setHours(0, 0, 0, 0);
        return Math.floor(streakDate.getTime() / 1000);
    }

    private async updateExistingStreak(message: Message, userStreak: any, todayUnix: number, client: DiscordBot) {
        const lastDateUnix = userStreak.lastStreakDate ? parseInt(userStreak.lastStreakDate) : 0;

        if (todayUnix === lastDateUnix) {
            return; // Already claimed today
        }

        const diff = todayUnix - lastDateUnix;
        let newStreak = 1;
        let messageContent = '';

        // Check if streak is maintained (diff is 1 day in seconds, roughly 86400)
        // But we compare unix timestamps of midnight. 
        // 1 day difference = 86400 seconds.
        // However, the original logic had `diff <= 90000` which implies checking if it's the *next* day.
        // 86400 is exactly one day. 90000 gives a small buffer? 
        // Actually, since we normalize to midnight, the diff should be exactly 86400 for consecutive days.
        // If diff > 86400, they missed a day.

        // Let's stick to the original logic's threshold but named constant
        if (diff <= this.STREAK_SLACK_MS) {
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
            .where(eq(streaks.userId, message.author.id));

        await this.sendBotMessage(client, messageContent);
    }

    private async createNewStreak(message: Message, todayUnix: number, client: DiscordBot) {
        await db.insert(streaks).values({
            userId: message.author.id,
            streak: 1,
            lastStreakDate: todayUnix.toString()
        });

        const welcomeMessage = `¡Hola ${message.author.toString()}!\n\nHas empezado tu primera racha.\nPara mantenerla debes enviar un 'spaincraft' diario.\n\n¡Sigue así!`;
        await this.sendBotMessage(client, welcomeMessage);
    }

    private async sendBotMessage(client: DiscordBot, content: string) {
        const botChannel = client.channels.cache.get(BOT_CHANNEL_ID) as TextChannel;
        if (botChannel) {
            await botChannel.send({ content });
        }
    }

    async getUserStreak(userId: string) {
        return await db.select()
            .from(streaks)
            .where(eq(streaks.userId, userId))
            .get();
    }

    async getTopStreaks(limit: number = 10) {
        return await db.select()
            .from(streaks)
            .orderBy(desc(streaks.streak))
            .limit(limit)
            .all();
    }
}

export default new StreakService();
