import { Events, Message } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import streakService from '../services/StreakService.js';

const STREAKS_CHANNEL_ID = config.channels.streaks;

export const name = Events.MessageCreate;
export const once = false;

export const execute = async (message: Message, client: DiscordBot) => {
    if (message.author.bot) return;
    if (message.channel.id !== STREAKS_CHANNEL_ID) return;

    if (message.content.toLowerCase().includes("spaincraft")) {
        await streakService.handleStreak(message, client);
    }
};

