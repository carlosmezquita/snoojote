import { glob } from 'glob';
import { type DiscordBot } from '../client.js';
import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (client: DiscordBot) => {
    const handlerPath = path.join(__dirname, '../../features');
    // Use forward slashes for glob pattern to ensure cross-platform compatibility
    const pattern = `${handlerPath.replace(/\\/g, '/')}/**/commands/*.{ts,js}`;
    const commandFiles = await glob(pattern);

    for (const file of commandFiles) {
        const fileUrl = pathToFileURL(file).href;
        const command = await import(fileUrl);
        // Handle both default export and named export, or just default
        const cmd = command.default || command;

        if (cmd.data && cmd.execute) {
            client.commands.set(cmd.data.name, cmd);
            client.logger.info(`[Handler] Loaded command: ${cmd.data.name}`);
        } else {
            client.logger.warn(`[Handler] Command at ${file} is missing data or execute property.`);
        }
    }

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        try {
            await command.execute(interaction as ChatInputCommandInteraction, client);
        } catch (error) {
            client.logger.error(error);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({
                        content: 'There was an error while executing this command!',
                        flags: MessageFlags.Ephemeral,
                    });
                } else {
                    await interaction.reply({
                        content: 'There was an error while executing this command!',
                        flags: MessageFlags.Ephemeral,
                    });
                }
            } catch (err) {
                client.logger.error(`Failed to send error message to user: ${err}`);
            }
        }
    });
};
