import cron from 'node-cron';
import { DiscordBot } from '../../../core/client.js';
import { TextChannel } from 'discord.js';
import { config } from '../../../config.js';
import triviaService from '../services/TriviaService.js';

const channelID = config.channels.main;

export const name = 'ready';
export const once = false;

export const execute = (client: DiscordBot) => {
    // Schedule the task
    cron.schedule('00 14 * * *', async () => {
        try {
            const channel = await client.channels.fetch(channelID) as TextChannel;
            if (channel) {
                await triviaService.processDailyQuestion(channel, client);
            } else {
                client.logger.error("Daily Question Error: Channel not found.");
            }
        } catch (error) {
            client.logger.error(`Daily Question Error: Could not fetch channel. ${error}`);
        }
    }, {
        scheduled: true,
        timezone: "Europe/Madrid"
    });

    client.logger.info('Daily Question cron scheduled for 14:00 Europe/Madrid');
};

