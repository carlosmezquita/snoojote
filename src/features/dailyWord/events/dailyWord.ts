import cron from 'node-cron';
import { EmbedBuilder, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import raeService from '../services/raeService.js';
import { config } from '../../../config.js';
import { createRaeEmbed } from '../utils/embedHelper.js';

export const name = 'ready';
export const once = false;

export const execute = (client: DiscordBot) => {
    // Schedule the task for 10:00 AM daily
    cron.schedule('0 10 * * *', async () => {
        try {
            await postDailyWord(client);
        } catch (error) {
            client.logger.error(`Daily Word Error: ${error}`);
        }
    }, {
        scheduled: true,
        timezone: "Europe/Madrid"
    });

    client.logger.info('Daily Word cron scheduled for 10:00 Europe/Madrid');
};

/**
 * Posts the daily word to the configured channel.
 * Can be called automatically by the scheduler or manually via admin command.
 */
export const postDailyWord = async (client: DiscordBot, channelOverride?: TextChannel) => {
    try {
        const channelId = config.channels.wordOfTheDay || config.channels.main;
        const channel = channelOverride || await client.channels.fetch(channelId) as TextChannel;

        if (!channel) {
            throw new Error("Channel not found.");
        }

        const word = await raeService.fetchWordOfTheDay();
        if (!word) {
            throw new Error("Could not fetch word of the day.");
        }

        const fetchResult = await raeService.fetchWordDefinition(word);
        if (!fetchResult.data) {
            throw new Error(`Could not fetch definition for ${word}.`);
        }

        const definitionData = fetchResult.data;

        const embed = createRaeEmbed(word, definitionData, { isDailyWord: true });

        await channel.send({ embeds: [embed] });
        client.logger.info(`Posted Word of the Day: ${word}`);
        return word;

    } catch (error) {
        throw error;
    }
}
