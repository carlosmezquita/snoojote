import cron from 'node-cron';
import { type DiscordBot } from '../../../core/client.js';
import { Events, type TextChannel } from 'discord.js';
import { config } from '../../../config.js';
import triviaService from '../services/TriviaService.js';

const channelID = config.channels.main;
const DAILY_QUESTION_CRON = '0 14 * * *';
let isScheduled = false;

export const name = Events.ClientReady;
export const once = true;

export const execute = (client: DiscordBot) => {
    if (isScheduled) {
        client.logger.warn(
            'Daily Question cron already scheduled; skipping duplicate registration.',
        );
        return;
    }

    isScheduled = true;

    cron.schedule(
        DAILY_QUESTION_CRON,
        async () => {
            await runDailyQuestion(client, 'scheduled');
        },
        {
            scheduled: true,
            timezone: 'Europe/Madrid',
        },
    );

    client.logger.info('Daily Question cron scheduled for 14:00 Europe/Madrid');

    setTimeout(() => {
        void runDailyQuestion(client, 'startup-catch-up');
    }, 10_000);
};

async function runDailyQuestion(client: DiscordBot, mode: 'scheduled' | 'startup-catch-up') {
    try {
        const channel = await client.channels.fetch(channelID);

        if (!channel || !channel.isTextBased()) {
            client.logger.error(
                `Daily Question Error: Channel ${channelID} not found or is not text-based.`,
            );
            return;
        }

        if (mode === 'startup-catch-up') {
            await triviaService.processDailyQuestionIfDue(channel as TextChannel, client);
        } else {
            await triviaService.processDailyQuestion(channel as TextChannel, client);
        }
    } catch (error) {
        client.logger.error(`Daily Question Error: Could not process ${mode}. ${error}`);
    }
}
