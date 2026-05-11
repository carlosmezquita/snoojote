import { REST, Routes } from 'discord.js';
import { glob } from 'glob';
import { pathToFileURL } from 'url';
import path from 'path';
import { config } from '../config.js';
import 'dotenv/config';

const token = process.env.TOKEN;
const clientId = config.clientId;
const guildId = config.guildId;

if (!token) {
    console.error('Missing TOKEN in .env');
    process.exit(1);
}
if (!clientId) {
    console.error('Missing CLIENT_ID in .env or config.ts');
    process.exit(1);
}

const commands = [];

(async () => {
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
            } else {
                console.warn(`[WARNING] The command at ${file} is missing a required "data" or "execute" property.`);
            }
        }

        const rest = new REST().setToken(token);

        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // If GUILD_ID is present, deploy to guild (faster for dev), otherwise global
        if (guildId) {
            console.log(`Deploying to guild: ${guildId}`);
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands },
            );
        } else {
            console.log('Deploying globally');
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );
        }

        console.log(`Successfully reloaded ${commands.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
})();
