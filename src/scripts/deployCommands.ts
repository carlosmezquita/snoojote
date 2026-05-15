import { REST, Routes } from 'discord.js';
import { glob } from 'glob';
import { pathToFileURL } from 'url';
import path from 'path';
import { config } from '../config.js';
import { assertBotConfigReady } from '../configLoader.js';
import logger from '../utils/logger.js';
import 'dotenv/config';

const token = process.env.TOKEN;
const clientId = config.clientId;
const guildId = config.guildId;

assertBotConfigReady();

if (!token) {
    logger.error('Missing TOKEN in .env');
    process.exit(1);
}
if (!clientId) {
    logger.error('Missing CLIENT_ID in .env or config.ts');
    process.exit(1);
}

const commands = [];

void (async () => {
    try {
        const sourcePath = path.join(process.cwd(), 'src/features');
        const pattern = `${sourcePath.replace(/\\/g, '/')}/**/commands/*.{ts,js}`;
        const commandFiles = await glob(pattern);

        for (const file of commandFiles) {
            const fileUrl = pathToFileURL(file).href;
            const command = await import(fileUrl);
            const cmd = command.default || command;

            if (cmd.data && cmd.execute) {
                commands.push(cmd.data.toJSON());

                if (cmd.aliases && Array.isArray(cmd.aliases)) {
                    for (const alias of cmd.aliases) {
                        const aliasData = cmd.data.toJSON();
                        aliasData.name = alias;
                        commands.push(aliasData);
                    }
                }
            } else {
                logger.warn('Command module is missing data or execute property', { file });
            }
        }

        const rest = new REST().setToken(token);

        logger.info('Started refreshing application commands', { commandCount: commands.length });

        // If GUILD_ID is present, deploy to guild (faster for dev), otherwise global
        if (guildId) {
            logger.info('Deploying application commands to guild', { guildId });
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        } else {
            logger.info('Deploying application commands globally');
            await rest.put(Routes.applicationCommands(clientId), { body: commands });
        }

        logger.info('Successfully reloaded application commands', {
            commandCount: commands.length,
        });
    } catch (error) {
        logger.error('Failed to deploy application commands', { error });
    }
})();
