import { Events, type Guild } from 'discord.js';
import responseTimeService from '../services/responseTimeService.js';

export const name = Events.GuildDelete;
export const once = false;
export const execute = (guild: Guild) => {
    responseTimeService.invalidateGuild(guild.id);
};
