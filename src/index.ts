import 'dotenv/config';
import { DiscordBot } from './core/client.js';
import logger from './utils/logger.js';
import { assertBotConfigReady } from './configLoader.js';
import { sqlite } from './database/db.js';
import cron from 'node-cron';

const client = new DiscordBot();

client.on('error', (error) => {
    logger.error('Discord client error', { error });
});

let stopping = false;
async function shutdown(code: number) {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(code || 1), 5000);
    deadline.unref();
    try {
        for (const task of cron.getTasks().values()) task.stop();
        await client.destroy();
        sqlite.close();
        await new Promise<void>((resolve) => {
            logger.once('finish', resolve);
            logger.end();
        });
    } catch (error) {
        console.error('Shutdown failed', error instanceof Error ? error.name : 'unknown');
    } finally {
        process.exit(code);
    }
}
process.once('SIGINT', () => {
    void shutdown(0);
});
process.once('SIGTERM', () => {
    void shutdown(0);
});
process.once('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
    void shutdown(1);
});
process.once('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
    void shutdown(1);
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
        await shutdown(1);
    }
})();
