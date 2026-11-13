import { PermissionFlagsBits, type GuildChannel } from 'discord.js';
import { config } from '../../../config.js';

export async function ensureSuspectLock(channel: GuildChannel) {
    const denied =
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.Connect;
    if (channel.permissionOverwrites.cache.get(config.roles.suspect)?.deny.has(denied)) return;
    await channel.permissionOverwrites.edit(config.roles.suspect, {
        ViewChannel: false,
        SendMessages: false,
        Connect: false,
    });
}
