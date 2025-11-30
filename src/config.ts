import 'dotenv/config';

export const config = {
    channels: {
        main: process.env.MAIN_CHANNEL_ID || "914557391067054081",
        alerts: process.env.ALERTS_CHANNEL_ID || "1079816654269194384",
        streaks: process.env.STREAKS_CHANNEL_ID || "914557391067054081",
        bot: process.env.BOT_CHANNEL_ID || "914557391067054081",
        logs: process.env.LOG_CHANNEL_ID || "667815242977247273",
        welcome: process.env.WELCOME_CHANNEL_ID || "457208061392584725",
        verifierCategory: process.env.VERIFIER_CATEGORY_ID || "1444480356932649254",
        ticketCategory: process.env.TICKET_CATEGORY_ID || ""
    },
    roles: {
        dailyPing: process.env.DAILY_PING_ROLE_ID || "711962609523621960",
        suspect: process.env.SUSPECT_ROLE_ID || "1444479211753701539",
        mod: process.env.MOD_ROLE_ID || "298102471040172032",
        support: process.env.SUPPORT_ROLE_ID || "",
        rPlace: "1131636103301050469",
        linkWhitelist: ["960199533927727144", "298102471040172032", "1131596076097474731"]
    },
    links: {
        whitelist: ["https://tenor.com/view/", "https://media.discordapp.net/", "https://cdn.discordapp.com/"]
    }
};
