import { Events, type GuildChannel } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';

import { config } from '../../../config.js';

const SUSPECT_ROLE_ID = config.roles.suspect;

export const name = Events.ChannelCreate;
export const once = false;

export const execute = async (channel: GuildChannel, client: DiscordBot) => {
    if (!channel.guild) return;
    try {
        if (!channel.permissionOverwrites.cache.has(SUSPECT_ROLE_ID)) {
            await channel.permissionOverwrites.edit(SUSPECT_ROLE_ID, {
                ViewChannel: false,
                SendMessages: false,
                Connect: false,
            });
        }
    } catch (err) {
        client.logger.error(`Lock Error: ${err}`);
    }
};
