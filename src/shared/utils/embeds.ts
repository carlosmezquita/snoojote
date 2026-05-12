import { EmbedBuilder, type ColorResolvable } from 'discord.js';

export const Colors = {
    Success: 0x00ae86 as ColorResolvable,
    Error: 0xf00000 as ColorResolvable,
    Warning: 0xf4af1b as ColorResolvable,
    Info: 0x5865f2 as ColorResolvable,
    Default: 0x0a0908 as ColorResolvable,
    Gold: 0xffd700 as ColorResolvable,
};

export function createEmbed(
    title: string,
    description: string,
    color: ColorResolvable = Colors.Default,
): EmbedBuilder {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

export function createSuccessEmbed(title: string, description: string): EmbedBuilder {
    return createEmbed(title, description, Colors.Success);
}

export function createErrorEmbed(title: string, description: string): EmbedBuilder {
    return createEmbed(title, description, Colors.Error);
}

export function createWarningEmbed(title: string, description: string): EmbedBuilder {
    return createEmbed(title, description, Colors.Warning);
}

export function createInfoEmbed(title: string, description: string): EmbedBuilder {
    return createEmbed(title, description, Colors.Info);
}
