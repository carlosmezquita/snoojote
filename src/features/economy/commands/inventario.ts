import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import shopService from '../services/shopService.js';
import { Colors } from '../../../shared/utils/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('inventario')
    .setDescription('Ver tus objetos y títulos comprados.');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const inventory = await shopService.getInventory(interaction.user.id);

    const embed = new EmbedBuilder()
        .setTitle(`🎒 Inventario de ${interaction.user.username}`)
        .setColor(Colors.Info)
        .setTimestamp();

    if (inventory.length === 0) {
        embed.setDescription('Tu inventario está vacío. ¡Visita la `/tienda`!');
    } else {
        const description = inventory
            .map((item) => {
                const date = new Date(item.acquiredAt).toLocaleDateString();
                return `• **${item.name}** - ${item.description} (Adquirido: ${date})`;
            })
            .join('\n');

        embed.setDescription(description);
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
};
