import { Events, Message, PermissionsBitField, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import { extractLinks, areLinksWhitelisted } from '../../../shared/utils/links.js';
import { createWarningEmbed, createErrorEmbed } from '../../../shared/utils/embeds.js';
import { RateLimitService } from '../../../shared/services/RateLimitService.js';
import moderationService from '../../../shared/services/ModerationService.js';

const cooldownSecs = 60;
const warnsLimit = 3;
const sendAlert = true;
const alertsChannelID = config.channels.alerts;
const whitelistLinks = config.links.whitelist;
const whitelistRoles = config.roles.linkWhitelist;

const rateLimiter = new RateLimitService(cooldownSecs);

export const name = Events.MessageCreate;
export const once = false;

export const execute = async (message: Message, client: DiscordBot) => {
    if (message.author.bot || !message.guild || !message.member) return;

    if (message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return;
    }

    for (const role of whitelistRoles) {
        if (message.member.roles.cache.has(role)) return;
    }

    const linkList = extractLinks(message.content);
    if (linkList.length === 0) return;

    if (areLinksWhitelisted(linkList, whitelistLinks)) return;

    const alertsChannel = client.channels.cache.get(alertsChannelID) as TextChannel;
    const currentCount = rateLimiter.check(message.author.id);

    if (currentCount < warnsLimit) {
        try {
            await message.author.send({
                embeds: [createWarningEmbed(
                    ':warning: ATENCIÓN',
                    `Has excedido el límite de envío de enlaces (1/${cooldownSecs}s). Por favor, espera.\n\nAvisos: ${currentCount}/${warnsLimit}`
                )]
            });
        } catch (err) {
            console.error(err);
        }
    }

    if (sendAlert && alertsChannel) {
        await alertsChannel.send({
            embeds: [
                createErrorEmbed(
                    'Protección automática contra spam',
                    `El usuario ha superado la tasa permitida de envío de enlaces`
                ).addFields(
                    { name: "Autor", value: message.author.toString(), inline: true },
                    { name: `Avisos`, value: `${currentCount}/${warnsLimit}`, inline: true },
                    { name: "Canal", value: message.channel.toString(), inline: true },
                    { name: 'Mensaje', value: message.content, inline: false }
                )
            ]
        });
    }

    await message.delete().catch(() => { });

    if (currentCount >= warnsLimit) {
        const member = message.member;
        if (!member) return;

        // Ban the user using the shared service
        await moderationService.ban(
            member,
            "Automatic ban for exceeding the link rate limit multiple times.",
            12 * 3600, // Delete messages from last 12 hours
            alertsChannel // Send log to alerts channel
        );
    }
};
