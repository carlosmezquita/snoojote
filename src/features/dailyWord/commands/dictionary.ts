import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import raeService from '../services/raeService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';
import { createRaeEmbed } from '../utils/embedHelper.js';

export const data = new SlashCommandBuilder()
    .setName('diccionario')
    .setDescription('Busca una palabra en el diccionario de la lengua española.')
    .addStringOption((option) =>
        option.setName('palabra').setDescription('La palabra a buscar').setRequired(true),
    );

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    try {
        await interaction.deferReply();
        const word = interaction.options.getString('palabra', true);

        const result = await raeService.fetchWordDefinition(word);

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
