import cron from 'node-cron';
import { type TextChannel } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import raeService from '../services/raeService.js';
import { config } from '../../../config.js';
import { createRaeEmbed } from '../utils/embedHelper.js';
import { DailyWordService } from '../services/dailyWordService.js';
import { DrizzleDailyWordStore } from '../services/dailyWordStore.js';

export const name = 'ready';
export const once = false;

const dailyWordService = new DailyWordService({
    store: new DrizzleDailyWordStore(),
    raeService,
    logger: {
        info: (message) => clientLogger?.info(message),
        warn: (message) => clientLogger?.warn(message),
        error: (message) => clientLogger?.error(message),
    },
});

let clientLogger: DiscordBot['logger'] | null = null;
let isScheduled = false;

export const execute = (client: DiscordBot) => {
    clientLogger = client.logger;

    if (isScheduled) {
        client.logger.warn('Daily Word cron already scheduled; skipping duplicate registration.');
        return;
    }

    isScheduled = true;

    // Prepare the payload ahead of the 10:00 send. The service owns persisted cooldowns.
    cron.schedule(
        '*/5 7-9 * * *',
        async () => {
            await prepareDailyWord(client, 'scheduled-prefetch');
        },
        {
            scheduled: true,
            timezone: 'Europe/Madrid',
        },
    );

    // Send only a payload that was prepared successfully before the deadline.
    cron.schedule(
        '0 10 * * *',
        async () => {
            await postPreparedDailyWord(client, 'scheduled-post');
        },
        {
            scheduled: true,
            timezone: 'Europe/Madrid',
        },
    );

    client.logger.info(
        'Daily Word prefetch cron scheduled every 5 minutes from 07:00 to 09:55 Europe/Madrid',
    );
    client.logger.info('Daily Word post cron scheduled for 10:00 Europe/Madrid');

    setTimeout(() => {
        void prepareDailyWord(client, 'startup-catch-up');
        if (getSpainHour(new Date()) >= 10) {
            void postPreparedDailyWord(client, 'startup-catch-up');
        }
    }, 10_000);
};

export const prepareDailyWord = async (
    client: DiscordBot,
    mode: 'scheduled-prefetch' | 'startup-catch-up',
) => {
    try {
        const result = await dailyWordService.prepareDailyWord();
        client.logger.info(`Daily Word ${mode} completed with status: ${result.status}`);
    } catch (error) {
        client.logger.error(`Daily Word ${mode} Error: ${error}`);
    }
};

export const postPreparedDailyWord = async (
    client: DiscordBot,
    mode: 'scheduled-post' | 'startup-catch-up',
) => {
    try {
        const now = new Date();
        const prepared = await dailyWordService.getPreparedDailyWord(now);

        if (!prepared) {
            client.logger.warn(`Daily Word ${mode}: no prepared payload to send.`);
            return null;
        }

        const channelId = config.channels.wordOfTheDay || config.channels.main;
        const channel = (await client.channels.fetch(channelId)) as TextChannel;

        if (!channel) {
            throw new Error('Channel not found.');
        }

        const embed = createRaeEmbed(prepared.word, prepared.definitionData, {
            isDailyWord: true,
        });

        await channel.send({ embeds: [embed] });
        await dailyWordService.markDailyWordPosted(now);
        client.logger.info(`Posted prepared Word of the Day: ${prepared.word}`);
        return prepared.word;
    } catch (error) {
        client.logger.error(`Daily Word ${mode} Error: ${error}`);
        return null;
    }
};

/**
 * Posts the daily word to the configured channel.
 * Can be called automatically by the scheduler or manually via admin command.
 */
export const postDailyWord = async (client: DiscordBot, channelOverride?: TextChannel) => {
    const channelId = config.channels.wordOfTheDay || config.channels.main;
    const channel = channelOverride || ((await client.channels.fetch(channelId)) as TextChannel);

    if (!channel) {
        throw new Error('Channel not found.');
    }

    const word = await raeService.fetchWordOfTheDay();
    if (!word) {
        throw new Error('Could not fetch word of the day.');
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
};

const getSpainHour = (date: Date) => {
    const hour = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Madrid',
        hour: '2-digit',
        hourCycle: 'h23',
    }).format(date);

    return Number(hour);
};
