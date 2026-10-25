import { Events } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import purchaseService from '../services/purchaseService.js';
import { discordRoleDelivery } from '../services/shopService.js';

export const name = Events.ClientReady;
export const once = true;
export const execute = async (client: DiscordBot) => {
    const roles = discordRoleDelivery(client);
    await purchaseService.recover(roles);
    const interval = setInterval(() => {
        void purchaseService.recover(roles).catch((error) => {
            client.logger.error('Purchase recovery failed', { error });
        });
    }, 60_000);
    interval.unref();
};
