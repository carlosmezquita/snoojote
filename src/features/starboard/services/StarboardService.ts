import {
    type Message,
    type TextChannel,
    EmbedBuilder,
    type PartialMessage,
    PermissionFlagsBits,
    ChannelType,
} from 'discord.js';
import db from '../../../database/db.js';
import { starboardMessages } from '../../../database/schema.js';
import { config } from '../../../config.js';
import { eq } from 'drizzle-orm';
import logger from '../../../utils/logger.js';
import { SerialQueue } from '../../../shared/services/SerialQueue.js';

const updates = new SerialQueue();

type Count = { emoji: { name: string | null }; count: number };

// An unset destination ID means the previous send may already have reached Discord.
async function findPublication(
    channel: TextChannel,
    sourceId: string,
): Promise<Message | undefined> {
    const bot = channel.client.user;
    if (
        !channel
            .permissionsFor(bot)
            ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
    )
        throw new Error('Cannot verify outstanding starboard publication without channel history');
    let before: string | undefined;
    const lowerBound = (BigInt(sourceId) >> 22n) << 22n;
    for (;;) {
        const page = await channel.messages.fetch({ limit: 100, before, cache: false });
        let oldest: bigint | undefined;
        for (const post of page.values()) {
            if (
                post.author.id === bot.id &&
                !post.webhookId &&
                post.embeds.some((embed) => embed.footer?.text === sourceId)
            )
                return post;
            const id = BigInt(post.id);
            if (oldest === undefined || id < oldest) oldest = id;
        }
        if (page.size < 100 || oldest === undefined || oldest <= lowerBound) return;
        before = oldest.toString();
    }
}

export class StarboardService {
    public static async handleReactionUpdate(
        message: Message | PartialMessage,
        counts?: Iterable<Count>,
    ) {
        return updates.run(message.id, () => this.update(message, counts));
    }

    private static async update(message: Message | PartialMessage, counts?: Iterable<Count>) {
        let fullMessage: Message;
        if (message.partial) {
            try {
                fullMessage = await message.fetch();
            } catch (error) {
                logger.warn('Failed to fetch partial message for starboard processing', {
                    messageId: message.id,
                    channelId: message.channelId,
                    error,
                });
                return;
            }
        } else {
            fullMessage = message as Message;
        }

        if (
            fullMessage.author.bot ||
            !fullMessage.guild ||
            !('permissionsFor' in fullMessage.channel)
        )
            return;
        const source = fullMessage.channel;
        if (source.type === ChannelType.PrivateThread) return;
        const sourceNsfw = source.isThread()
            ? source.parent?.nsfw
            : 'nsfw' in source && source.nsfw;
        // An uncached parent cannot establish a thread's age restriction safely.
        if (source.isThread() && !source.parent) return;
        // Never copy private support/moderation messages into a public starboard.
        if (
            !fullMessage.channel
                .permissionsFor(fullMessage.guild.roles.everyone)
                ?.has(PermissionFlagsBits.ViewChannel)
        )
            return;

        const starboardChannelId = config.channels.starboard;
        // Don't track reactions in the starboard channel itself
        if (!starboardChannelId || fullMessage.channel.id === starboardChannelId) return;

        const emojis = config.starboard.emojis;
        const minReactions = config.starboard.minReactions;

        let winningEmoji = '';
        let highestCount = 0;

        // Iterate over reactions to find the winner
        for (const reaction of counts ?? fullMessage.reactions.cache.values()) {
            const emojiName = reaction.emoji.name;
            if (emojiName && emojis.includes(emojiName)) {
                if (reaction.count > highestCount) {
                    highestCount = reaction.count;
                    winningEmoji = emojiName;
                }
            }
        }

        // DB Check
        let [existing] = await db
            .select()
            .from(starboardMessages)
            .where(eq(starboardMessages.originalMessageId, fullMessage.id));

        const starboardChannel = (fullMessage.client.channels.cache.get(starboardChannelId) ??
            (await fullMessage.client.channels.fetch(starboardChannelId))) as TextChannel | null;
        if (!starboardChannel) throw new Error('Starboard destination unavailable');
        if (
            starboardChannel.guildId !== fullMessage.guildId ||
            (sourceNsfw && !starboardChannel.nsfw)
        ) {
            // Silently return if channel not configured or found, or log warning
            return;
        }

        if (existing && !existing.starboardMessageId) {
            const post = await findPublication(starboardChannel, fullMessage.id);
            if (post) {
                existing = db
                    .update(starboardMessages)
                    .set({ starboardMessageId: post.id })
                    .where(eq(starboardMessages.id, existing.id))
                    .returning()
                    .get();
            }
        }
        if (highestCount >= minReactions) {
            const embed = this.createStarboardEmbed(fullMessage, winningEmoji, highestCount);

            const payload = {
                content: `${winningEmoji} **${highestCount}** <#${fullMessage.channel.id}>`,
                embeds: [embed],
            };
            if (existing && existing.starboardMessageId) {
                // Update existing
                try {
                    const starboardMessage = await starboardChannel.messages.fetch({
                        message: existing.starboardMessageId,
                        force: true,
                    });
                    if (
                        starboardMessage.content === payload.content &&
                        starboardMessage.embeds[0]?.equals(embed.toJSON())
                    )
                        return;
                    await starboardMessage.edit(payload);
                } catch (e) {
                    logger.error('Failed to update starboard message', {
                        originalMessageId: fullMessage.id,
                        starboardMessageId: existing.starboardMessageId,
                        error: e,
                    });
                    if (e && typeof e === 'object' && 'code' in e && e.code === 10008) {
                        await db
                            .delete(starboardMessages)
                            .where(eq(starboardMessages.id, existing.id));
                        throw new Error(
                            'Starboard projection disappeared; refresh the source again',
                            { cause: e },
                        );
                    }
                    throw e;
                }
            } else {
                // Commit intent before the external send. A retry searches history
                // for the source footer before attempting another publication.
                existing ??= db
                    .insert(starboardMessages)
                    .values({
                        originalMessageId: fullMessage.id,
                        originalChannelId: fullMessage.channel.id,
                    })
                    .returning()
                    .get();
                const starboardMessage = await starboardChannel.send({
                    nonce: `sb:${fullMessage.id}`,
                    enforceNonce: true,
                    ...payload,
                });
                db.update(starboardMessages)
                    .set({ starboardMessageId: starboardMessage.id })
                    .where(eq(starboardMessages.id, existing.id))
                    .run();
                if (starboardMessage.content !== payload.content)
                    await starboardMessage.edit(payload);
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
                    } catch (error) {
                        if (!(
                            error &&
                            typeof error === 'object' &&
                            'code' in error &&
                            error.code === 10008
                        ))
                            throw error;
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
            .setDescription(message.content.slice(0, 4096) || '*Mensaje sin texto*')
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
