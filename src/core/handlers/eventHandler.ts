import { glob } from 'glob';
import { DiscordBot } from '../client.js';

export default async (client: DiscordBot) => {
    const eventFiles = await glob(`${process.cwd()}/src/features/**/events/*.{ts,js}`);

    for (const file of eventFiles) {
        const eventModule = await import(file);
        const event = eventModule.default || eventModule;

        if (event.name && event.execute) {
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
            client.logger.info(`[Handler] Loaded event: ${event.name}`);
        }
    }
};
