import { Events, type Message } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import streakService from '../services/StreakService.js';

export const name = Events.MessageCreate;
export const once = false;

export const execute = async (message: Message, client: DiscordBot) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    if (
        config.streaks.channelIds.includes(message.channelId) &&
        message.content.trim().length >= 10
    ) {
        await streakService.handleStreak(message, client);
    }
};
