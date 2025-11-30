const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

module.exports = async (client) => {
    const commandFiles = await glob(`${process.cwd()}/src/features/**/commands/*.js`);

    for (const file of commandFiles) {
        const command = require(file);
        if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
            console.log(`[Handler] Loaded command: ${command.data.name}`);
        } else {
            console.warn(`[Handler] Command at ${file} is missing data or execute property.`);
        }
    }

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
            }
        }
    });
};
