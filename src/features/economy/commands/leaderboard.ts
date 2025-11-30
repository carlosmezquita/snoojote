import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import economyService from '../services/economyService.js';

export const data = new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top 10 users by points.');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const leaderboard = await economyService.getLeaderboard(10);

    const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🏆 Leaderboard')
        .setTimestamp();

    let description = '';
    for (const [index, entry] of leaderboard.entries()) {
        const user = await client.users.fetch(entry.user_id).catch(() => null);
        const username = user ? user.username : 'Unknown User';
        description += `${index + 1}. **${username}** - ${entry.points} points\n`;
    }

    if (description === '') {
        description = 'No data yet.';
    }

    embed.setDescription(description);

    await interaction.reply({ embeds: [embed] });
};
