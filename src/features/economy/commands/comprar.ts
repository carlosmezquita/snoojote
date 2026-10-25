import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
} from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import shopService from '../services/shopService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';
import { shopCatalog } from '../shopConfig.js';

// Create choices from catalog
const itemChoices = shopCatalog.map((item) => ({
    name: `${item.emoji} ${item.name} (${item.price} ₧)`,
    value: item.name,
}));

export const data = new SlashCommandBuilder()
    .setName('comprar')
    .setDescription('Comprar un artículo de la tienda o ver el catálogo.')
    .addStringOption((option) =>
        option
            .setName('rango')
            .setDescription('Selecciona el Rango que deseas comprar')
            .setRequired(false)
            .addChoices(...itemChoices),
    );

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    await shopService.seedItems();
    const itemName = interaction.options.getString('rango');

    // If no item selected, show catalog
    if (!itemName) {
        await shopService.seedItems();
        const items = await shopService.getShopItems();

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
        return;
    }

    // Process Buy Confirmation
    const item = await shopService.getItemByName(itemName);
    if (!item) {
        await interaction.reply({
            content: 'El artículo seleccionado no existe.',
            ephemeral: true,
        });
        return;
    }

    const confirmEmbed = new EmbedBuilder()
        .setTitle('Confirmar Compra')
        .setDescription(
            `¿Estás seguro de que quieres comprar **${item.name}** por **${item.price} ₧**?`,
        )
        .setColor(Colors.Warning);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('confirm_buy')
            .setLabel('Confirmar')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('cancel_buy')
            .setLabel('Cancelar')
            .setStyle(ButtonStyle.Danger),
    );

    const response = await interaction.reply({
        embeds: [confirmEmbed],
        components: [row],
        ephemeral: true,
    });

    let confirmation;
    try {
        confirmation = await response.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: (button) => button.user.id === interaction.user.id,
            time: 60_000,
        });
    } catch {
        await interaction.editReply({
            content: 'Tiempo de espera agotado. Compra cancelada.',
            embeds: [],
            components: [],
        });
        return;
    }
    if (confirmation.customId !== 'confirm_buy') {
        await confirmation.update({ content: 'Compra cancelada.', embeds: [], components: [] });
        return;
    }
    await confirmation.deferUpdate();
    const result = await shopService.buyItem(confirmation, itemName);
    const resultEmbed = createEmbed(
        result.success ? '¡Compra Exitosa!' : 'Error en la Compra',
        result.message,
        result.success ? Colors.Success : Colors.Error,
    );
    await interaction.editReply({ embeds: [resultEmbed], components: [] });
};
