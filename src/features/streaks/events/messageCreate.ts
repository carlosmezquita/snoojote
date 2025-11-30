import { Events, Message, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';

import { config } from '../../../config.js';

const STREAKS_CHANNEL_ID = config.channels.streaks;
const BOT_CHANNEL_ID = config.channels.bot;

export const name = Events.MessageCreate;
export const once = false;

export const execute = async (message: Message, client: DiscordBot) => {
    if (message.author.bot) return;
    if (message.channel.id !== STREAKS_CHANNEL_ID) return;

    if (message.content.toLowerCase().includes("spaincraft")) {
        await handleStreak(message, client);
    }
};

async function handleStreak(message: Message, client: DiscordBot) {
    const userId = message.author.id;
    const now = new Date();

    // Logic to determine "Streak Day" (starts at 14:00)
    // If it's before 14:00, it counts for the previous calendar day? 
    // Or rather, the "day" is defined as 14:00 to 14:00 next day.
    // The original code: if hours < 14, setDate(getDate() - 1).
    // So 13:00 on 2nd counts as 1st. 15:00 on 2nd counts as 2nd.

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
                // Already claimed for this "day"
                return;
            }

            // Check if streak is continuous
            // Difference between todayUnix and lastDateUnix should be 1 day (86400 seconds)
            // The original code allowed <= 90000 (25 hours) difference? 
            // Wait, original code: if (today - lastMessageDate <= 90000)
            // If todayUnix is normalized to midnight, the diff should be exactly 86400 if it's the next day.
            // If it's 2 days later, diff is 172800.

            const diff = todayUnix - lastDateUnix;

            let newStreak = 1;
            let messageContent = '';

            if (diff <= 90000) { // Allow some slack, basically if it's the next day
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
