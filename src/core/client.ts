import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DiscordBot extends Client {
    public commands: Collection<string, any>;
    public logger: typeof logger;

    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.DirectMessages
            ],
            partials: [Partials.Channel, Partials.Message]
        });

        this.commands = new Collection();
        this.logger = logger;
    }

    async start(token: string) {
        await this.loadHandlers();
        await this.login(token);
    }

    async loadHandlers() {
        const handlerPath = path.join(__dirname, 'handlers');
        const handlers = fs.readdirSync(handlerPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

        for (const file of handlers) {
            const filePath = path.join(handlerPath, file);
            const fileUrl = pathToFileURL(filePath).href;
            const handler = await import(fileUrl);
            if (handler.default) {
                await handler.default(this);
            }
        }
    }
}
