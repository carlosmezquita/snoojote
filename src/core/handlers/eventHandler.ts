import { fileURLToPath, pathToFileURL } from 'url';
import { glob } from 'glob';
import path from 'path';
import { DiscordBot } from '../client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (client: DiscordBot) => {
    const handlerPath = path.join(__dirname, '../../features');
    const pattern = `${handlerPath.replace(/\\/g, '/')}/**/events/*.{ts,js}`;
    const eventFiles = await glob(pattern);

    for (const file of eventFiles) {
        const fileUrl = pathToFileURL(file).href;
        const eventModule = await import(fileUrl);
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
