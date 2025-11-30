import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import { processDailyQuestion } from '../events/dailyQuestion.js';

export const data = new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Manually trigger the daily question (Admin only).');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    // Check permissions (simple check for now, can be improved)
    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel as TextChannel;
    if (!channel) {
        await interaction.editReply('This command can only be used in a text channel.');
        return;
    }

    try {
        await processDailyQuestion(channel, client);
        await interaction.editReply('Daily question triggered successfully.');
    } catch (error) {
        client.logger.error(`Error triggering daily question: ${error}`);
        await interaction.editReply('Failed to trigger daily question.');
    }
};
