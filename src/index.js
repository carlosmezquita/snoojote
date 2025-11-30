require('dotenv').config();
const DiscordBot = require('./core/client');
const logger = require('./utils/logger');

const client = new DiscordBot();

(async () => {
    try {
        logger.info('Starting bot...');
        await client.start(process.env.TOKEN);
        logger.success('Bot started successfully!');
    } catch (error) {
        logger.error('Failed to start bot:');
        console.error(error);
    }
})();
