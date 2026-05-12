import {
    type User,
    type APIEmbedField,
    EmbedBuilder,
    type ColorResolvable,
    type AttachmentBuilder,
    type Attachment,
    type TextChannel,
} from 'discord.js';
import { Colors } from '../utils/embeds.js';
import { config } from '../../config.js';

export enum DMType {
    Info = 'info',
    Success = 'success',
    Warning = 'warning',
    Sanction = 'sanction',
    Gift = 'gift',
    Neutral = 'neutral',
}

export interface DMOptions {
    user: User;
    type: DMType;
    title: string;
    description: string;
    fields?: APIEmbedField[];
    footer?: string;
    timestamp?: boolean;
    files?: (AttachmentBuilder | Attachment | string)[];
}

export interface DMWithFallbackOptions extends DMOptions {
    fallbackChannelId?: string;
    fallbackContent?: string;
}

export interface DMDeliveryResult {
    dmSent: boolean;
    fallbackSent: boolean;
}

export class DMService {
    public static async send(options: DMOptions): Promise<boolean> {
        const { user, type, title, description, fields, footer, timestamp = true, files } = options;

        const embed = this.buildEmbed({ type, title, description, fields, footer, timestamp });

        try {
            await user.send({ embeds: [embed], files: files });
            return true;
        } catch (error) {
            // Cannot DM user (blocked, closed DMs, etc.)
            // We swallow the error here as we often can't do anything about it
            // but return false so the caller knows it failed.
            return false;
        }
    }

    public static async sendWithFallback(
        options: DMWithFallbackOptions,
    ): Promise<DMDeliveryResult> {
        const { user, files } = options;
        const embed = this.buildEmbed(options);

        try {
            await user.send({ embeds: [embed], files });
            return { dmSent: true, fallbackSent: false };
        } catch (error) {
            const fallbackSent = await this.sendFallback(user, embed, options);
            return { dmSent: false, fallbackSent };
        }
    }

    private static buildEmbed(
        options: Pick<
            DMOptions,
            'type' | 'title' | 'description' | 'fields' | 'footer' | 'timestamp'
        >,
    ): EmbedBuilder {
        const { type, title, description, fields, footer, timestamp = true } = options;
        const color = this.getColorByType(type);

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color);

        if (fields && fields.length > 0) {
            embed.setFields(fields);
        }

        if (footer) {
            embed.setFooter({ text: footer });
        } else {
            embed.setFooter({
                text: `r/Spain Discord`,
                iconURL:
                    'https://media.discordapp.net/attachments/298140651676237824/1051478405897527316/rspainupscaled.png',
            });
        }

        if (timestamp) {
            embed.setTimestamp();
        }

        return embed;
    }

    private static async sendFallback(
        user: User,
        embed: EmbedBuilder,
        options: DMWithFallbackOptions,
    ): Promise<boolean> {
        const fallbackChannelId = options.fallbackChannelId || config.channels.bot;
        const fallbackChannel = (await user.client.channels
            .fetch(fallbackChannelId)
            .catch(() => null)) as TextChannel | null;

        if (!fallbackChannel || !fallbackChannel.isTextBased()) return false;

        try {
            await fallbackChannel.send({
                content:
                    options.fallbackContent ||
                    `${user.toString()} no he podido enviarte esta notificación por MD, así que la publico aquí.`,
                embeds: [embed],
                files: options.files,
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    private static getColorByType(type: DMType): ColorResolvable {
        switch (type) {
            case DMType.Info:
                return Colors.Info;
            case DMType.Success:
                return Colors.Success;
            case DMType.Warning:
                return Colors.Warning;
            case DMType.Sanction:
                return Colors.Error;
            case DMType.Gift:
                return Colors.Gold;
            case DMType.Neutral:
            default:
                return Colors.Default;
        }
    }

    // --- Helper Methods using the Options pattern ---

    public static async sendInfo(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.send({ user, type: DMType.Info, title, description, fields });
    }

    public static async sendInfoWithFallback(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.sendWithFallback({ user, type: DMType.Info, title, description, fields });
    }

    public static async sendSuccess(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.send({ user, type: DMType.Success, title, description, fields });
    }

    public static async sendSuccessWithFallback(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.sendWithFallback({ user, type: DMType.Success, title, description, fields });
    }

    public static async sendWarning(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.send({ user, type: DMType.Warning, title, description, fields });
    }

    public static async sendWarningWithFallback(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.sendWithFallback({ user, type: DMType.Warning, title, description, fields });
    }

    public static async sendSanction(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.send({ user, type: DMType.Sanction, title, description, fields });
    }

    public static async sendGift(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.send({ user, type: DMType.Gift, title, description, fields });
    }

    public static async sendGiftWithFallback(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.sendWithFallback({ user, type: DMType.Gift, title, description, fields });
    }

    public static async sendNeutral(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.send({ user, type: DMType.Neutral, title, description, fields });
    }

    public static async sendNeutralWithFallback(
        user: User,
        title: string,
        description: string,
        fields?: APIEmbedField[],
    ) {
        return this.sendWithFallback({ user, type: DMType.Neutral, title, description, fields });
    }
}
