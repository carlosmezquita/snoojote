import { ActivityType } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';

export const name = 'clientReady';
export const once = true;

export const execute = async (client: DiscordBot) => {
    client.user?.setActivity('Spaincraftiano desde nacimiento', { type: ActivityType.Playing });
    client.logger.info('Bot status set: Spaincraftiano desde nacimiento');
};
