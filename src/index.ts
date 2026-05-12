import 'dotenv/config';
import { DiscordBot } from './core/client.js';
import logger from './utils/logger.js';
import { assertBotConfigReady } from './configLoader.js';

const client = new DiscordBot();

client.on('error', (error) => {
    logger.error(`Discord Client Error: ${error}`);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
});

void (async () => {
    try {
        logger.info('Starting bot...');
        if (!process.env.TOKEN) {
            throw new Error('TOKEN is not defined in .env');
        }
        assertBotConfigReady();
        await client.start(process.env.TOKEN);
        logger.info(`Logged in as ${client.user?.tag}!`);
    } catch (error) {
        logger.error('Failed to start bot:');
        console.error(error);
        process.exitCode = 1;
    }
})();
