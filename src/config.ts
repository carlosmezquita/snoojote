import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
    DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
    DISCORD_GUILD_ID: z.string().min(1, 'DISCORD_GUILD_ID is required').optional(),
    CHANNEL_MAIN: z.string().min(1, 'CHANNEL_MAIN is required'),
    CHANNEL_ALERTS: z.string().min(1, 'CHANNEL_ALERTS is required'),
    CHANNEL_STREAKS: z.string().min(1, 'CHANNEL_STREAKS is required'),
    CHANNEL_BOT: z.string().min(1, 'CHANNEL_BOT is required'),
    CHANNEL_LOGS: z.string().min(1, 'CHANNEL_LOGS is required'),
    CHANNEL_WELCOME: z.string().min(1, 'CHANNEL_WELCOME is required'),
    CHANNEL_VERIFIER_CATEGORY: z.string().min(1, 'CHANNEL_VERIFIER_CATEGORY is required'),
    CHANNEL_TICKET_CATEGORY: z.string().min(1, 'CHANNEL_TICKET_CATEGORY is required'),
    CHANNEL_STARBOARD: z.string().min(1, 'CHANNEL_STARBOARD is required'),
    CHANNEL_AI: z.string().min(1, 'CHANNEL_AI is required'),
    CHANNEL_WORD_OF_THE_DAY: z.string().min(1, 'CHANNEL_WORD_OF_THE_DAY is required'),
    CHANNEL_TRANSCRIPTS: z.string().min(1, 'CHANNEL_TRANSCRIPTS is required').optional(),
    ROLE_DAILY_PING: z.string().min(1, 'ROLE_DAILY_PING is required'),
    ROLE_SUSPECT: z.string().min(1, 'ROLE_SUSPECT is required'),
    ROLE_MOD: z.string().min(1, 'ROLE_MOD is required'),
    ROLE_SUPPORT: z.string().min(1, 'ROLE_SUPPORT is required'),
    ROLE_RPLACE: z.string().min(1, 'ROLE_RPLACE is required'),
    ROLE_LINK_WHITELIST_IDS: z.string().min(1, 'ROLE_LINK_WHITELIST_IDS is required'),
    MAX_OPEN_TICKETS_PER_USER: z.coerce.number().int().positive().default(3),
});

const env = envSchema.parse(process.env);

export const config = {
    clientId: env.DISCORD_CLIENT_ID,
    guildId: env.DISCORD_GUILD_ID,
    channels: {
        main: env.CHANNEL_MAIN,
        alerts: env.CHANNEL_ALERTS,
        streaks: env.CHANNEL_STREAKS,
        bot: env.CHANNEL_BOT,
        logs: env.CHANNEL_LOGS,
        welcome: env.CHANNEL_WELCOME,
        verifierCategory: env.CHANNEL_VERIFIER_CATEGORY,
        ticketCategory: env.CHANNEL_TICKET_CATEGORY,
        starboard: env.CHANNEL_STARBOARD,
        ai: env.CHANNEL_AI,
        wordOfTheDay: env.CHANNEL_WORD_OF_THE_DAY,
        transcripts: env.CHANNEL_TRANSCRIPTS || env.CHANNEL_LOGS
    },
    roles: {
        dailyPing: env.ROLE_DAILY_PING,
        suspect: env.ROLE_SUSPECT,
        mod: env.ROLE_MOD,
        support: env.ROLE_SUPPORT,
        rPlace: env.ROLE_RPLACE,
        linkWhitelist: env.ROLE_LINK_WHITELIST_IDS.split(',').map(id => id.trim())
    },
    links: {
        whitelist: ["https://tenor.com/view/", "https://media.discordapp.net/", "https://cdn.discordapp.com/"]
    },
    starboard: {
        emojis: ["🤡", "⭐"],
        minReactions: 3
    },
    tickets: {
        maxOpenPerUser: env.MAX_OPEN_TICKETS_PER_USER
    }
};
