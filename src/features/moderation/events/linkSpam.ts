import { Events, PermissionsBitField, type Client, type Message } from 'discord.js';
import { config } from '../../../config.js';
import { extractLinks, areLinksWhitelisted } from '../../../shared/utils/links.js';
import { createWarningEmbed, createErrorEmbed } from '../../../shared/utils/embeds.js';
import logger from '../../../utils/logger.js';
import {
    recordLink,
    enforceLink,
    type LinkEvent,
    type SpamActions,
} from '../services/linkSpamJournal.js';
export { getLinkRateLimitDecision } from '../services/linkSpamJournal.js';

export const name = Events.MessageCreate;
export const once = false;
export function eligible(message: Message) {
    if (
        !message.guild ||
        !message.member ||
        message.author.bot ||
        message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
        config.roles.linkWhitelist.some((id) => message.member!.roles.cache.has(id))
    )
        return false;
    const links = extractLinks(message.content);
    return links.length > 0 && !areLinksWhitelisted(links, config.links.whitelist);
}
const reason = 'Automatic ban for exceeding the link rate limit multiple times.';
function discordCode(error: unknown, code: number) {
    return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}

export function actionsFor(
    client: Client,
    event: LinkEvent,
    count: number,
    message?: Message,
): SpamActions {
    const { userId, guildId, channelId, messageId } = event;
    const guild = message?.guild ?? client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Link moderation guild unavailable');
    const sendAlert = async (embed: ReturnType<typeof createErrorEmbed>) => {
        const channel = client.channels.cache.get(config.channels.alerts);
        if (!channel?.isSendable()) throw new Error('Moderation alerts channel unavailable');
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    };
    return {
        async remove() {
            try {
                if (message) await message.delete();
                else await client.rest.delete(`/channels/${channelId}/messages/${messageId}`);
            } catch (error) {
                if (!discordCode(error, 10008)) throw error;
            }
        },
        async ban() {
            await guild.members.ban(userId, { reason, deleteMessageSeconds: 43200 });
        },
        async isBanned() {
            try {
                return !!(await guild.bans.fetch({ user: userId, force: true }));
            } catch (error) {
                if (discordCode(error, 10026)) return false;
                throw error;
            }
        },
        async dm() {
            const user = message?.author ?? (await client.users.fetch(userId));
            await user.send({
                embeds: [
                    count === 4
                        ? createErrorEmbed(
                              'Baneado',
                              `Has sido baneado del servidor.\n**Razón:** ${reason}`,
                          )
                        : createWarningEmbed(
                              '⚠️ ATENCIÓN',
                              `Has excedido el límite de envío de enlaces (1/60s). Por favor, espera.\n\nAvisos: ${count - 1}/3`,
                          ),
                ],
            });
        },
        async alert() {
            await sendAlert(
                createErrorEmbed(
                    'Protección automática contra spam',
                    'El usuario ha superado la tasa permitida de envío de enlaces',
                ).addFields(
                    { name: 'Autor', value: `<@${userId}>`, inline: true },
                    { name: 'Avisos', value: String(count - 1), inline: true },
                    { name: 'Canal', value: `<#${channelId}>`, inline: true },
                    { name: 'Mensaje', value: message?.content.slice(0, 1024) || messageId },
                ),
            );
        },
        async banLog() {
            await sendAlert(
                createErrorEmbed(
                    'Usuario Baneado',
                    `<@${userId}> ha sido baneado.\n**Razón:** ${reason}`,
                ),
            );
        },
        failed(action, error) {
            logger.warn('Link moderation action failed', { messageId, action, error });
        },
    };
}

export async function execute(message: Message, client: Client, delayMs = 0) {
    if (!eligible(message)) return;
    const event = {
        guildId: message.guildId!,
        channelId: message.channelId,
        userId: message.author.id,
        messageId: message.id,
        observedAt: message.createdTimestamp,
    };
    const count = recordLink(event);
    if (delayMs && count && count > 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (count && count > 1)
        await enforceLink(event.messageId, count, actionsFor(client, event, count, message));
}
