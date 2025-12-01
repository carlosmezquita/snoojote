import { Events, Message, PermissionsBitField, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import { extractLinks, areLinksWhitelisted } from '../../../shared/utils/links.js';
import { createWarningEmbed, createErrorEmbed } from '../../../shared/utils/embeds.js';
import { RateLimitService } from '../../../shared/services/RateLimitService.js';
import moderationService from '../../../shared/services/ModerationService.js';

const COOLDOWN_SECS = 60;
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

    if (message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return true;
    }

    if (config.roles.linkWhitelist.some(roleId => message.member?.roles.cache.has(roleId))) {
        return true;
    }

    return false;
}

async function handleSpam(message: Message, client: DiscordBot) {
    const currentCount = rateLimiter.check(message.author.id);
    const alertsChannel = client.channels.cache.get(config.channels.alerts) as TextChannel;

    if (currentCount < WARNS_LIMIT) {
        await sendWarning(message, currentCount);
    }

    if (SEND_ALERT && alertsChannel) {
        await sendAlertLog(message, alertsChannel, currentCount);
    }

    await message.delete().catch(() => { });

    if (currentCount >= WARNS_LIMIT) {
        await banUser(message, alertsChannel);
    }
}

async function sendWarning(message: Message, currentCount: number) {
    try {
        await message.author.send({
            embeds: [createWarningEmbed(
                ':warning: ATENCIÓN',
                `Has excedido el límite de envío de enlaces (1/${COOLDOWN_SECS}s). Por favor, espera.\n\nAvisos: ${currentCount}/${WARNS_LIMIT}`
            )]
        });
    } catch (err) {
        console.error(`Failed to send warning to ${message.author.tag}:`, err);
    }
}

async function sendAlertLog(message: Message, channel: TextChannel, currentCount: number) {
    await channel.send({
        embeds: [
            createErrorEmbed(
                'Protección automática contra spam',
                `El usuario ha superado la tasa permitida de envío de enlaces`
            ).addFields(
                { name: "Autor", value: message.author.toString(), inline: true },
                { name: `Avisos`, value: `${currentCount}/${WARNS_LIMIT}`, inline: true },
                { name: "Canal", value: message.channel.toString(), inline: true },
                { name: 'Mensaje', value: message.content, inline: false }
            )
        ]
    });
}

async function banUser(message: Message, alertsChannel: TextChannel) {
    const member = message.member;
    if (!member) return;

    await moderationService.ban(
        member,
        "Automatic ban for exceeding the link rate limit multiple times.",
        12 * 3600, // Delete messages from last 12 hours
        alertsChannel
    );
}
