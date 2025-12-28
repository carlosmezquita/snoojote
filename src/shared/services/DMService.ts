import { User, APIEmbedField, EmbedBuilder, ColorResolvable, AttachmentBuilder, Attachment } from 'discord.js';
import { Colors } from '../utils/embeds.js';

export enum DMType {
    Info = 'info',
    Success = 'success',
    Warning = 'warning',
    Sanction = 'sanction',
    Gift = 'gift',
    Neutral = 'neutral'
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

export class DMService {
    public static async send(options: DMOptions): Promise<boolean> {
        const { user, type, title, description, fields, footer, timestamp = true, files } = options;

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
                iconURL: 'https://media.discordapp.net/attachments/298140651676237824/1051478405897527316/rspainupscaled.png'
            });
        }

        if (timestamp) {
            embed.setTimestamp();
        }

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

    public static async sendInfo(user: User, title: string, description: string, fields?: APIEmbedField[]) {
        return this.send({ user, type: DMType.Info, title, description, fields });
    }

    public static async sendSuccess(user: User, title: string, description: string, fields?: APIEmbedField[]) {
        return this.send({ user, type: DMType.Success, title, description, fields });
    }

    public static async sendWarning(user: User, title: string, description: string, fields?: APIEmbedField[]) {
        return this.send({ user, type: DMType.Warning, title, description, fields });
    }

    public static async sendSanction(user: User, title: string, description: string, fields?: APIEmbedField[]) {
        return this.send({ user, type: DMType.Sanction, title, description, fields });
    }

    public static async sendGift(user: User, title: string, description: string, fields?: APIEmbedField[]) {
        return this.send({ user, type: DMType.Gift, title, description, fields });
    }

    public static async sendNeutral(user: User, title: string, description: string, fields?: APIEmbedField[]) {
        return this.send({ user, type: DMType.Neutral, title, description, fields });
    }
}
