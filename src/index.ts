import 'dotenv/config';
import { DiscordBot } from './core/client.js';
import logger from './utils/logger.js';

const client = new DiscordBot();

(async () => {
    try {
        logger.info('Starting bot...');
        if (!process.env.TOKEN) {
            throw new Error('TOKEN is not defined in .env');
        }
        await client.start(process.env.TOKEN);
        logger.info(`Logged in as ${client.user?.tag}!`);
    } catch (error) {
        logger.error('Failed to start bot:');
        console.error(error);
    }
})();
