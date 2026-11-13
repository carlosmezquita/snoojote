import { Events, type Client } from 'discord.js';
import { config } from '../../../config.js';
import logger from '../../../utils/logger.js';
import { voiceObserver } from '../services/voiceLedger.js';
export const name = Events.ClientReady;
export const once = true;
export function execute(client: Client) {
    const scan = (initial: boolean) => {
        if (!client.isReady()) return;
        for (const guild of client.guilds.cache.values())
            if (!config.guildId || config.guildId === guild.id)
                try {
                    voiceObserver.snapshot(guild, initial);
                } catch (error) {
                    logger.error('Voice checkpoint failed', { guildId: guild.id, error });
                }
    };
    scan(true);
    setInterval(() => scan(false), 15_000).unref();
}
