import { Events } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import ticketService from '../services/ticketService.js';

export const name = Events.ClientReady;
export const once = true;
export const execute = async (client: DiscordBot) => {
    const recover = async () => {
        for (const guild of client.guilds.cache.values())
            await ticketService.recoverIncompleteTickets(guild);
    };
    await recover();
    const interval = setInterval(() => {
        void recover().catch((error) => {
            client.logger.error('Incomplete ticket recovery failed', { error });
        });
    }, 5 * 60_000);
    interval.unref();
};
