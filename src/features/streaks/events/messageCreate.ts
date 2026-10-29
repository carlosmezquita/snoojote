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
        message.channelId === config.channels.main &&
        message.content.toLowerCase().includes('spaincraft')
    ) {
        await streakService.handleStreak(message, client);
    }
};
