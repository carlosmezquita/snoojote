import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import shopService from '../services/shopService.js';
import { Colors } from '../../../shared/utils/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('tienda')
    .setDescription('Ver los artículos disponibles en la tienda.');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    // Ensure items exist
    await shopService.seedItems();

    const items = await shopService.getShopItems();

    // Matching the style of /comprar as requested
    const embed = new EmbedBuilder()
        .setTitle('🛒 Comprar Artículos')
        .setDescription('Selecciona un artículo del menú `/comprar [rango]` para adquirirlo.')
        .setColor(Colors.Gold);

    if (items.length === 0) {
        embed.setDescription('La tienda está vacía.');
    } else {
        const fields = items.map((item) => {
            const typeEmoji = item.emoji ? item.emoji : item.type === 'ROLE' ? '👑' : '📦';
            return {
                name: `${typeEmoji} ${item.name}`,
                value: `**${item.price} ₧**\n${item.description}`,
                inline: true,
            };
        });
        embed.addFields(fields);
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
};
