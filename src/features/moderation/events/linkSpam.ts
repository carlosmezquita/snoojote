import { Events, type Message, PermissionsBitField, type TextChannel } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import { extractLinks, areLinksWhitelisted } from '../../../shared/utils/links.js';
import { createWarningEmbed, createErrorEmbed } from '../../../shared/utils/embeds.js';
import { RateLimitService } from '../../../shared/services/RateLimitService.js';
import moderationService from '../../../shared/services/ModerationService.js';
import logger from '../../../utils/logger.js';

const COOLDOWN_SECS = 60;
const LINKS_LIMIT = 1;
const WARNS_LIMIT = 3;
const SEND_ALERT = true;

const rateLimiter = new RateLimitService(COOLDOWN_SECS);

export const name = Events.MessageCreate;
export const once = false;

export const execute = async (message: Message, client: DiscordBot) => {
    if (shouldIgnoreMessage(message)) return;

    const linkList = extractLinks(message.content);
    if (linkList.length === 0) return;

    if (areLinksWhitelisted(linkList, config.links.whitelist)) return;

    await handleSpam(message, client);
};

function shouldIgnoreMessage(message: Message): boolean {
    if (message.author.bot || !message.guild || !message.member) return true;

    if (
        message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)
    ) {
        return true;
    }

    if (config.roles.linkWhitelist.some((roleId) => message.member?.roles.cache.has(roleId))) {
        return true;
    }

    return false;
}

async function handleSpam(message: Message, client: DiscordBot) {
    const currentCount = rateLimiter.check(`${message.guildId}:${message.author.id}`);
    const decision = getLinkRateLimitDecision(currentCount);
    if (!decision.shouldDelete) return;

    const alertsChannel = client.channels.cache.get(config.channels.alerts) as TextChannel;

    // Enforce first. Notification failures must never prevent deletion or a sanction.
    await message.delete().catch((error) => {
        client.logger.warn('Failed to delete link spam message', { messageId: message.id, error });
    });
    if (decision.shouldBan)
        await banUser(message, alertsChannel).catch((error) => {
            client.logger.error('Failed to ban link spam member', {
                userId: message.author.id,
                error,
            });
        });
    else await sendWarning(message, decision.violationCount);
    if (SEND_ALERT && alertsChannel?.isTextBased()) {
        await sendAlertLog(message, alertsChannel, decision.violationCount).catch((error) => {
            client.logger.warn('Failed to log link spam', { messageId: message.id, error });
        });
    }
}

export function getLinkRateLimitDecision(currentCount: number): {
    shouldDelete: boolean;
    shouldBan: boolean;
    violationCount: number;
} {
    const violationCount = Math.max(currentCount - LINKS_LIMIT, 0);

    return {
        shouldDelete: violationCount > 0,
        shouldBan: violationCount >= WARNS_LIMIT,
        violationCount,
    };
}

async function sendWarning(message: Message, violationCount: number) {
    try {
        await message.author.send({
            embeds: [
                createWarningEmbed(
                    ':warning: ATENCIÓN',
                    `Has excedido el límite de envío de enlaces (${LINKS_LIMIT}/${COOLDOWN_SECS}s). Por favor, espera.\n\nAvisos: ${violationCount}/${WARNS_LIMIT}`,
                ),
            ],
        });
    } catch (err) {
        logger.warn('Failed to send link spam warning DM', {
            userId: message.author.id,
            userTag: message.author.tag,
            error: err,
        });
    }
}

async function sendAlertLog(message: Message, channel: TextChannel, violationCount: number) {
    await channel.send({
        embeds: [
            createErrorEmbed(
                'Protección automática contra spam',
                `El usuario ha superado la tasa permitida de envío de enlaces`,
            ).addFields(
                { name: 'Autor', value: message.author.toString(), inline: true },
                { name: `Avisos`, value: `${violationCount}/${WARNS_LIMIT}`, inline: true },
                { name: 'Canal', value: message.channel.toString(), inline: true },
                {
                    name: 'Mensaje',
                    value: message.content.slice(0, 1024) || '[sin texto]',
                    inline: false,
                },
            ),
        ],
    });
}

async function banUser(message: Message, alertsChannel: TextChannel) {
    const member = message.member;
    if (!member) return;

    await moderationService.ban(
        member,
        'Automatic ban for exceeding the link rate limit multiple times.',
        12 * 3600, // Delete messages from last 12 hours
        alertsChannel,
    );
}
