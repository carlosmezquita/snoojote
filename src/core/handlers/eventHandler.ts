import { fileURLToPath, pathToFileURL } from 'url';
import { glob } from 'glob';
import path from 'path';
import { type DiscordBot } from '../client.js';
import { type BotEvent } from '../contracts.js';
import { config } from '../../config.js';

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

        if (typeof event.name !== 'string' || typeof event.execute !== 'function') {
            throw new Error(`Invalid event module: ${file}`);
        }
        registerEvent(client, event as BotEvent);
    }
};

export function registerEvent(client: DiscordBot, event: BotEvent): void {
    const listener = (...args: unknown[]) => {
        const first = args[0] as { guildId?: string; guild?: { id: string } } | undefined;
        const guildId = first?.guildId ?? first?.guild?.id;
        if (guildId && config.guildId && guildId !== config.guildId) return;
        void Promise.resolve()
            .then(() => event.execute(...args, client))
            .catch((error: unknown) => {
                client.logger.error('Event execution failed', {
                    event: event.name,
                    guildId,
                    error,
                });
            });
    };
    if (event.once) client.once(event.name, listener);
    else client.on(event.name, listener);
    client.logger.debug('Loaded event handler', { event: event.name });
}
