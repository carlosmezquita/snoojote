import { glob } from 'glob';
import { DiscordBot } from '../client.js';
import { ChatInputCommandInteraction } from 'discord.js';
import path from 'path';

export default async (client: DiscordBot) => {
    const commandFiles = await glob(`${process.cwd()}/src/features/**/commands/*.{ts,js}`);

    for (const file of commandFiles) {
        const command = await import(file);
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
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
            }
        }
    });
};
