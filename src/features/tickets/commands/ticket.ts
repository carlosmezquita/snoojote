import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import * as ticketAdd from './ticketAdd.js';
import * as ticketRemove from './ticketRemove.js';

export const data = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage ticket members.')
    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Add a user to the ticket.')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('The user to add to the ticket.')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('remove')
            .setDescription('Remove a user from the ticket.')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('The user to remove from the ticket.')
                    .setRequired(true)
            )
    );
    // Removed default permissions to allow ticket owners to use it.
    // Permissions are checked inside the subcommands.

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
        await ticketAdd.execute(interaction, client);
    } else if (subcommand === 'remove') {
        await ticketRemove.execute(interaction, client);
    }
};
