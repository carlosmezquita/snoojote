import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import shopService from '../services/shopService.js';
import { Colors } from '../../../shared/utils/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('tienda')
    .setDescription('Ver los artículos disponibles en la tienda.');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    // Ensure items exist
    await shopService.seedItems();

    const items = await shopService.getShopItems();

    const embed = new EmbedBuilder()
        .setTitle('🏰 Tienda de Historia Española')
        .setDescription('Compra títulos y objetos históricos con tus Pesetas (₧).')
        .setColor(Colors.Gold)
        .setThumbnail('https://i.imgur.com/example.png'); // You might want a real image later

    if (items.length === 0) {
        embed.setDescription('La tienda está vacía por ahora.');
    } else {
        const fields = items.map(item => {
            const typeEmoji = item.type === 'ROLE' ? '👑' : '📦';
            return {
                name: `${typeEmoji} ${item.name} (ID: ${item.id})`,
                value: `**${item.price} ₧**\n*${item.description}*`,
                inline: true
            };
        });
        embed.addFields(fields);
        embed.setFooter({ text: 'Usa /comprar <id> para adquirir un artículo.' });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
};
