import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import economyService from '../services/economyService.js';

export const data = new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Muestra los 10 usuarios con más pesetas.');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const leaderboard = await economyService.getLeaderboard(10);

    const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('🏆 Usuarios con más pesetas')
        .setTimestamp();

    let description = '';
    for (const [index, entry] of leaderboard.entries()) {
        const user = await client.users.fetch(entry.user_id).catch(() => null);
        const username = user ? user.username : 'Usuario desconocido';
        description += `${index + 1}. **${username}** - ${entry.points} ₧\n`;
    }

    if (description === '') {
        description = 'Todavía no hay datos.';
    }

    embed.setDescription(description);

    await interaction.reply({ embeds: [embed] });
};
