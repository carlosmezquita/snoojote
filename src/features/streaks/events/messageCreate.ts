import { Events, Message } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import streakService from '../services/StreakService.js';

const MIN_SIGNIFICANT_MESSAGE_LENGTH = 10;

export const name = Events.MessageCreate;
export const once = false;

export const execute = async (message: Message, client: DiscordBot) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!config.streaks.channelIds.includes(message.channel.id)) return;
    if (message.content.trim().length <= MIN_SIGNIFICANT_MESSAGE_LENGTH) return;

    await streakService.handleStreak(message, client);
};
