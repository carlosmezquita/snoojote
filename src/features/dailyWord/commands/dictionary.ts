import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import raeService from '../services/raeService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';
import { createRaeEmbed } from '../utils/embedHelper.js';
import { Cooldown } from '../../../shared/services/Cooldown.js';
const requests = new Cooldown();

export const data = new SlashCommandBuilder()
    .setName('diccionario')
    .setDescription('Busca una palabra en el diccionario de la lengua española.')
    .addStringOption((option) =>
        option
            .setName('palabra')
            .setMaxLength(128)
            .setDescription('La palabra a buscar')
            .setRequired(true),
    );

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    if (!requests.acquire(interaction.user.id, 15_000)) {
        await interaction.reply({
            content: 'Espera unos segundos antes de volver a consultar el diccionario.',
            ephemeral: true,
        });
        return;
    }
    try {
        await interaction.deferReply();
        const word = interaction.options.getString('palabra', true);

        const result = await raeService.fetchWordDefinition(word);

        if (result.unavailable) {
            await interaction.editReply(
                'El diccionario no está disponible. Inténtalo de nuevo más tarde.',
            );
            return;
        }
        if (!result.data) {
            // Handle 404/Not Found
            let description = `No se encontró la palabra "**${word}**" en el diccionario de la lengua española.`;

            if (result.suggestions && result.suggestions.length > 0) {
                description += `\n\n**Quizás quisiste decir:**\n${result.suggestions.map((s) => `• ${s}`).join('\n')}`;
            }

            const embed = createEmbed('Palabra no encontrada', description, Colors.Error);
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        const definitionData = result.data;
        const embed = createRaeEmbed(definitionData.word, definitionData);

        // URL is set by the helper.

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        client.logger.error(`Error executing /diccionario: ${error}`);
        // Try to reply if not already replied/deferred, or edit if deferred
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: 'Ocurrió un error al buscar la palabra.' });
            } else {
                await interaction.reply({
                    content: 'Ocurrió un error al buscar la palabra.',
                    ephemeral: true,
                });
            }
        } catch {
            // Best-effort user notification after the original command failure.
        }
    }
};
