import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import streakService from '../services/StreakService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('topstreaks')
    .setDescription('Show the top 10 streaks.');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const topStreaks = await streakService.getTopStreaks(10);

    if (!topStreaks.length) {
        await interaction.reply({ content: 'No streaks found.', ephemeral: true });
        return;
    }

    const description = topStreaks.map((s, i) => {
        return `${i + 1}. <@${s.userId}> - **${s.streak}** days`;
    }).join('\n');

    const embed = createEmbed(
        '🏆 Top Streaks',
        description,
        Colors.Gold
    ).setTimestamp();

    await interaction.reply({ embeds: [embed] });
};
