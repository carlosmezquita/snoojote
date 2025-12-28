import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import shopService from '../services/shopService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';
import { shopCatalog } from '../shopConfig.js';

// Create choices from catalog
// Note: Discord choices limit is 25. Our catalog is small so this is fine.
const itemChoices = shopCatalog.map(item => ({
    name: `${item.name} (${item.price} ₧)`,
    value: item.name
}));

export const data = new SlashCommandBuilder()
    .setName('comprar')
    .setDescription('Comprar un artículo de la tienda.')
    .addStringOption(option =>
        option.setName('articulo')
            .setDescription('Selecciona el artículo que deseas comprar')
            .setRequired(true)
            .addChoices(...itemChoices));

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    const itemName = interaction.options.getString('articulo', true);

    await interaction.deferReply({ ephemeral: true });

    // Ensure logic in service uses Name now
    const result = await shopService.buyItem(interaction, itemName);

    const embed = createEmbed(
        result.success ? '¡Compra Exitosa!' : 'Error en la Compra',
        result.message,
        result.success ? Colors.Success : Colors.Error
    );

    await interaction.editReply({ embeds: [embed] });
};
