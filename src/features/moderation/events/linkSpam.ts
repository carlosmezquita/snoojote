import { Events, Message, EmbedBuilder, PermissionsBitField, TextChannel, GuildMember } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';

import { config } from '../../../config.js';

const recentLink = new Map<string, { counter: number, invokingMessageId: string, invokingMessage: string }>();
const cooldownSecs = 60;
const warnsLimit = 3;
const sendAlert = true;
const alertsChannelID = config.channels.alerts;

const whitelistLinks = config.links.whitelist;
const whitelistRoles = config.roles.linkWhitelist;

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

    if (areLinksWhitelisted(linkList)) return;

    const alertsChannel = client.channels.cache.get(alertsChannelID) as TextChannel;

    const userRateLimitData = recentLink.get(message.author.id);

    if (userRateLimitData) {
        await rateLimitedAction(message, alertsChannel, userRateLimitData);
        return;
    }

    recentLink.set(message.author.id, { counter: 0, invokingMessageId: message.id, invokingMessage: message.content });

    setTimeout(() => {
        recentLink.delete(message.author.id);
    }, cooldownSecs * 1000);
};

function extractLinks(message: string): string[] {
    const regex = /(https?:\/\/[\w\-+%?=&#]+\.[\w\-+%?=&#]+[^\s"']*)/g;
    const links = message.match(regex);
    return links || [];
}

function areLinksWhitelisted(linkList: string[]): boolean {
    for (let link of linkList) {
        if (!isLinkWhitelisted(link)) return false;
    }
    return true;
}

function isLinkWhitelisted(url: string): boolean {
    for (let domain of whitelistLinks) {
        if (url.startsWith(domain)) return true;
    }
    return false;
}

async function rateLimitedAction(message: Message, channel: TextChannel | undefined, userRateLimitData: { counter: number }) {
    userRateLimitData.counter++;

    if (userRateLimitData.counter < warnsLimit) {
        try {
            await message.author.send({
                embeds: [new EmbedBuilder()
                    .setTitle(`:warning: ATENCIÓN`)
                    .setDescription(`Has excedido el límite de envío de enlaces (1/${cooldownSecs}s) permitido por el servidor. Por favor, espera antes de enviar más enlaces.\n\nIncumplir esta norma puede resultar en una expulsión inmediata.`)
                    .addFields({ name: "Avisos", value: userRateLimitData.counter + "/" + warnsLimit, inline: true })
                    .setFooter({ text: `Tus avisos expirarán a los ${cooldownSecs} segundos.` })
                    .setColor(0xf4af1b)]
            });
        } catch (err) {
            console.error(err);
        }
    }

    if (sendAlert && channel) {
        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setAuthor({ name: "Alerta" })
                    .setTitle("Protección automática contra spam.")
                    .setDescription("El usuario ha superado la tasa permitida de envío de enlaces")
                    .addFields(
                        { name: "Autor", value: message.author.toString(), inline: true },
                        { name: `Avisos (${cooldownSecs}s)`, value: userRateLimitData.counter + "/" + warnsLimit, inline: true },
                        { name: "Canal", value: message.channel.toString(), inline: true },
                        { name: 'Mensaje', value: message.content, inline: false }
                    )
                    .setFooter({ text: "Peligro de nivel medio." })
                    .setColor(0xF00000)
            ]
        });
    }

    await message.delete().catch(() => { });

    if (userRateLimitData.counter === warnsLimit) {
        const member = message.member;
        if (!member) return;

        try {
            await member.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Expulsión Automática")
                        .setDescription("Has sido expulsado del servidor por superar el límite de envío de enlaces en múltiples ocasiones.")
                        .addFields({ name: `Avisos`, value: userRateLimitData.counter + "/" + warnsLimit, inline: true })
                        .setFooter({ text: "Staff de r/Spain", iconURL: "https://media.discordapp.net/attachments/298140651676237824/1051478405897527316/rspainupscaled.png?width=1280&height=1280" })
                        .setTimestamp()
                        .setColor(0x0a0908)
                ]
            });
        } catch (err) {
            console.error(err);
        }

        if (channel) {
            channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setAuthor({ name: "Alerta" })
                        .setTitle("Expulsión automática")
                        .setDescription(`Se ha expulsado a ${message.author.toString()} por superar el límite de envío de enlaces en múltiples ocasiones.`)
                        .addFields(
                            { name: "Nombre", value: message.author.tag, inline: true },
                            { name: "Se unió:", value: member.joinedAt ? member.joinedAt.toLocaleDateString() : 'Unknown', inline: true },
                            { name: `Avisos (${cooldownSecs}s)`, value: userRateLimitData.counter + "/" + warnsLimit, inline: true }
                        )
                        .setTimestamp()
                        .setColor(0x0a0908)
                ]
            });
        }

        await member.ban({ deleteMessageSeconds: 12 * 3600, reason: "Automatic ban for exceeding the link rate limit multiple times." }).catch(console.error);
    }
}
