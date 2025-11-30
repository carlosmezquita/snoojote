const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('../database');

class DiscordBot extends Client {
    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.DirectMessages
            ],
            partials: [Partials.Channel, Partials.Message]
        });

        this.commands = new Collection();
        this.db = db;
    }

    async start(token) {
        this.loadHandlers();
        await this.login(token);
    }

    loadHandlers() {
        const handlerPath = path.join(__dirname, 'handlers');
        const handlers = fs.readdirSync(handlerPath).filter(file => file.endsWith('.js'));

        for (const file of handlers) {
            require(path.join(handlerPath, file))(this);
        }
    }
}

module.exports = DiscordBot;
