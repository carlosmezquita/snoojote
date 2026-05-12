import 'dotenv/config';
import { loadBotConfig } from './configLoader.js';

const runtimeConfig = loadBotConfig({ validatePlaceholders: false });

export const config = {
    clientId: runtimeConfig.discord.clientId,
    guildId: runtimeConfig.discord.guildId,
    channels: {
        ...runtimeConfig.channels,
        transcripts: runtimeConfig.channels.transcripts || runtimeConfig.channels.logs,
    },
    roles: runtimeConfig.roles,
    links: runtimeConfig.links,
    starboard: runtimeConfig.starboard,
    tickets: runtimeConfig.tickets,
    streaks: runtimeConfig.streaks,
    ai: runtimeConfig.ai,
    economy: runtimeConfig.economy,
};
