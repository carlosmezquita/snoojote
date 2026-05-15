import { Events, Collection } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import inviteCache from '../services/InviteCacheService.js';

export const name = Events.ClientReady;
export const once = true;

export const execute = async (client: DiscordBot) => {
    client.logger.info('Caching guild invites', { guildCount: client.guilds.cache.size });
    client.guilds.cache.forEach(async (guild) => {
        try {
            const invites = await guild.invites.fetch();
            inviteCache.set(
                guild.id,
                new Collection(invites.map((inv) => [inv.code, inv.uses || 0])),
            );
        } catch (e) {
            client.logger.error('Failed to cache guild invites', {
                guildId: guild.id,
                guildName: guild.name,
                error: e,
            });
        }
    });
};
