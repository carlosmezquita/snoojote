import { type Message, type TextChannel, EmbedBuilder, type PartialMessage } from 'discord.js';
import db from '../../../database/db.js';
import { starboardMessages } from '../../../database/schema.js';
import { config } from '../../../config.js';
import { eq } from 'drizzle-orm';

export class StarboardService {
    public static async handleReactionUpdate(message: Message | PartialMessage) {
        let fullMessage: Message;
        if (message.partial) {
            try {
                fullMessage = await message.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the message: ', error);
                return;
            }
        } else {
            fullMessage = message as Message;
        }

        if (fullMessage.author.bot) return;

        const starboardChannelId = config.channels.starboard;
        // Don't track reactions in the starboard channel itself
        if (!starboardChannelId || fullMessage.channel.id === starboardChannelId) return;

        const emojis = config.starboard.emojis;
        const minReactions = config.starboard.minReactions;

        let winningEmoji = '';
        let highestCount = 0;

        // Iterate over reactions to find the winner
        for (const reaction of fullMessage.reactions.cache.values()) {
            const emojiName = reaction.emoji.name;
            if (emojiName && emojis.includes(emojiName)) {
                if (reaction.count > highestCount) {
                    highestCount = reaction.count;
                    winningEmoji = emojiName;
                }
            }
        }

        // DB Check
        const [existing] = await db
            .select()
            .from(starboardMessages)
            .where(eq(starboardMessages.originalMessageId, fullMessage.id));

        const starboardChannel = fullMessage.client.channels.cache.get(
            starboardChannelId,
        ) as TextChannel;
        if (!starboardChannel) {
            // Silently return if channel not configured or found, or log warning
            return;
        }

        if (highestCount >= minReactions) {
            const embed = this.createStarboardEmbed(fullMessage, winningEmoji, highestCount);

            if (existing && existing.starboardMessageId) {
                // Update existing
                try {
                    const starboardMessage = await starboardChannel.messages.fetch(
                        existing.starboardMessageId,
                    );
                    await starboardMessage.edit({
                        content: `${winningEmoji} **${highestCount}** <#${fullMessage.channel.id}>`,
                        embeds: [embed],
                    });
                } catch (e) {
                    console.error('Failed to update starboard message', e);
                    // If message deleted manually from starboard channel, maybe we should treat it as "removed" or repost?
                    // For now, let's assume if it fails to fetch/edit, we might want to repost if it's 404
                }
            } else {
                // Create new
                const starboardMessage = await starboardChannel.send({
                    content: `${winningEmoji} **${highestCount}** <#${fullMessage.channel.id}>`,
                    embeds: [embed],
                });
                await db.insert(starboardMessages).values({
                    originalMessageId: fullMessage.id,
                    originalChannelId: fullMessage.channel.id,
                    starboardMessageId: starboardMessage.id,
                });
            }
        } else {
            // Count dropped below min
            if (existing) {
                if (existing.starboardMessageId) {
                    try {
                        const starboardMessage = await starboardChannel.messages.fetch(
                            existing.starboardMessageId,
                        );
                        await starboardMessage.delete();
                    } catch (e) {
                        // Message might already be deleted
                    }
                }
                await db.delete(starboardMessages).where(eq(starboardMessages.id, existing.id));
            }
        }
    }

    private static createStarboardEmbed(
        message: Message,
        emoji: string,
        count: number,
    ): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
            .setDescription(message.content || '*Mensaje sin texto*')
            .setColor('#ffe97f')
            .addFields({ name: 'Origen', value: `[Ir al mensaje](${message.url})` })
            .setFooter({ text: message.id })
            .setTimestamp(message.createdAt);

        const firstAttachment = message.attachments.first();
        if (firstAttachment && firstAttachment.contentType?.startsWith('image/')) {
            embed.setImage(firstAttachment.url);
        }

        return embed;
    }
}
