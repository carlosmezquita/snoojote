import { Events, type Message } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import streakService from '../services/StreakService.js';

const MIN_SIGNIFICANT_MESSAGE_LENGTH = 10;

export const name = Events.MessageCreate;
export const once = false;

export const execute = async (message: Message, client: DiscordBot) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const isMainChannel = message.channel.id === config.channels.main;
    const hasKeyword = message.content.toLowerCase().includes('spaincraft');

    if (isMainChannel && hasKeyword) {
        await streakService.handleStreak(message, client);
    }
};
