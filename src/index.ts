import 'dotenv/config';
import { DiscordBot } from './core/client.js';
import logger from './utils/logger.js';
import { assertBotConfigReady } from './configLoader.js';

const client = new DiscordBot();

client.on('error', (error) => {
    logger.error('Discord client error', { error });
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', { promise, reason });
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
});

void (async () => {
    try {
        logger.info('Starting bot');
        if (!process.env.TOKEN) {
            throw new Error('TOKEN is not defined in .env');
        }
        assertBotConfigReady();
        await client.start(process.env.TOKEN);
        logger.info('Bot logged in', { user: client.user?.tag });
    } catch (error) {
        logger.error('Failed to start bot', { error });
        process.exitCode = 1;
    }
})();
