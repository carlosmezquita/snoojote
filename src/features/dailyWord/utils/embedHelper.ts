import { EmbedBuilder } from 'discord.js';
import { type WordEntryData } from '../services/raeService.js';

interface EmbedOptions {
    isDailyWord?: boolean;
}

export const createRaeEmbed = (
    word: string,
    definitionData: WordEntryData,
    options: EmbedOptions = {},
): EmbedBuilder => {
    const embed = new EmbedBuilder()
        .setTitle(word)
        .setURL(
            `https://dle.rae.es/${encodeURIComponent(word)}${options.isDailyWord ? '?m=wotd2' : ''}`,
        )
        .setColor(options.isDailyWord ? '#00b4d8' : '#caf0f8')
        .setFooter({
            iconURL: 'https://dle.rae.es/assets/images/dle.jpg',
            text: `Diccionario de la lengua española`,
        })
        .setTimestamp();

    if (options.isDailyWord) {
        embed.setAuthor({
            name: 'Palabra del Día',
        });
    }

    if (definitionData.meanings.length === 0) {
        embed.setDescription('No se encontraron definiciones para esta palabra.');
        return embed;
    }

    let description = '';
    let count = 0;

    for (const meaning of definitionData.meanings) {
        if (!meaning.senses) continue;
        for (const sense of meaning.senses) {
            if (!sense.raw) continue;
            // Remove the leading number from the API response (e.g. "1. f. Arq." -> "f. Arq.")
            const cleanDef = sense.raw.replace(/^\d+\.\s+/, '');

            // Check if adding this definition would exceed the embed description limit (4096 chars)
            // Adding a small buffer for safety
            const nextEntry = `**${count + 1}.** ${cleanDef}\n\n`;
            if (description.length + nextEntry.length > 4000) {
                description += `...\n*(Definiciones truncadas debido a la longitud)*`;
                embed.setDescription(description);
                return embed;
            }

            description += nextEntry;
            count++;
        }
    }

    if (!description) {
        description = 'No se encontraron definiciones.';
    }

    embed.setDescription(description);
    return embed;
};
