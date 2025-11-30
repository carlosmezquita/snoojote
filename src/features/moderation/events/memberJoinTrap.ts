import { Events, GuildMember, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, TextChannel, Collection } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import inviteCache from '../utils/inviteCache.js';
import verificationState from '../utils/verificationState.js';
import { generateCaptchaText, drawCaptchaImage } from '../utils/captcha.js';

import { config } from '../../../config.js';

const SUSPECT_ROLE_ID = config.roles.suspect;
const MOD_ROLE_ID = config.roles.mod;
const VERIFIER_CATEGORY_ID = config.channels.verifierCategory;
const LOG_CHANNEL_ID = config.channels.logs;
const THREE_MONTHS_MS = 1000 * 60 * 60 * 24 * 90;
const KICK_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export const name = Events.GuildMemberAdd;
export const once = false;

export const execute = async (member: GuildMember, client: DiscordBot) => {
    client.logger.info(`👉 Event Triggered: User ${member.user.tag} joined.`);
    const guild = member.guild;

    const cachedInvites = inviteCache.get(guild.id);
    const newInvites = await guild.invites.fetch();

    // Find used invite
    let usedInvite = newInvites.find(inv => {
        const oldUses = cachedInvites ? cachedInvites.get(inv.code) || 0 : 0;
        return (inv.uses || 0) > oldUses;
    });

    // Update cache
    inviteCache.set(guild.id, new Collection(newInvites.map(inv => [inv.code, inv.uses || 0])));

    client.logger.info(`   -> Invite used: ${usedInvite ? usedInvite.code : "Unknown"}`);

    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    if (accountAgeMs > THREE_MONTHS_MS) return;

    client.logger.warn(`   -> 🚨 TRAP TRIGGERED for ${member.user.tag}`);

    try {
        await member.roles.add(SUSPECT_ROLE_ID);
        await sendLog(guild, `🚨 **Nuevo Sospechoso:** <@${member.id}> (${member.user.tag})\n**Cuenta:** ${(accountAgeMs / (1000 * 60 * 60 * 24)).toFixed(1)} días.`, client);

        // CREATE SECURE CHANNEL
        const channel = await guild.channels.create({
            name: `verify-${member.user.username.substring(0, 10)}`,
            type: ChannelType.GuildText,
            parent: VERIFIER_CATEGORY_ID,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: client.user!.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                },
                {
                    id: MOD_ROLE_ID,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                },
                {
                    id: member.id,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.AddReactions,
                        PermissionFlagsBits.CreatePublicThreads,
                        PermissionFlagsBits.CreatePrivateThreads
                    ]
                }
            ]
        });

        // SEND INITIAL CHALLENGE
        const payload = await generateChallengePayload(member.id, MAX_ATTEMPTS);
        const msg = await channel.send(payload);

        const state = {
            attempts: 0,
            channelId: channel.id,
            mainMsgId: msg.id,
            warningMsgId: null as string | null,
            timeouts: [] as NodeJS.Timeout[]
        };

        // TIMER LOGIC
        const scheduleWarning = (ms: number, text: string) => {
            const tid = setTimeout(async () => {
                try {
                    if (state.warningMsgId) {
                        const existingMsg = await channel.messages.fetch(state.warningMsgId).catch(() => null);
                        if (existingMsg) await existingMsg.delete();
                    }
                    const newMsg = await channel.send(`<@${member.id}> ⏳ **${text}**`);
                    state.warningMsgId = newMsg.id;
                } catch (e) { client.logger.error(`Timer Error: ${e}`); }
            }, ms);
            state.timeouts.push(tid);
        };

        scheduleWarning(2 * 60 * 1000, "Quedan 8 minutos / 8 minutes remaining");
        scheduleWarning(4 * 60 * 1000, "Quedan 6 minutos / 6 minutes remaining");
        scheduleWarning(6 * 60 * 1000, "Quedan 4 minutos / 4 minutes remaining");
        scheduleWarning(8 * 60 * 1000, "Quedan 2 minutos / 2 minutes remaining");
        scheduleWarning(9.5 * 60 * 1000, "⚠️ **30 segundos restantes / 30 seconds remaining!**");

        const kickTid = setTimeout(async () => {
            const currentMember = await guild.members.fetch(member.id).catch(() => null);
            if (currentMember && currentMember.roles.cache.has(SUSPECT_ROLE_ID)) {
                await currentMember.kick("Tiempo agotado.");
                await sendLog(guild, `💀 **Expulsado (Timeout):** <@${member.id}>`, client);
                if (channel) await channel.delete().catch(() => { });
                verificationState.delete(member.id);
            }
        }, KICK_TIMEOUT_MS);

        state.timeouts.push(kickTid);
        verificationState.set(member.id, state);

    } catch (error) { client.logger.error(`Trap Error: ${error}`); }
};

async function sendLog(guild: any, text: string, client: DiscordBot) {
    try {
        const channel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null) as TextChannel;
        if (channel) await channel.send(`🛡️ **Seguridad:** ${text}`);
    } catch (err) { client.logger.error(`Log Error: ${err}`); }
}

export async function generateChallengePayload(memberId: string, attemptsLeft: number) {
    const captchaText = generateCaptchaText();
    const imageBuffer = await drawCaptchaImage(captchaText);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'challenge.png' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`verify_btn_${captchaText}`)
            .setLabel('Verificar / Verify')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔒')
    );

    const embed = {
        title: "⚠️ Verificación Requerida / Verification Required",
        description: "**ES:** Escriba el texto de la imagen para entrar.\n**EN:** Enter the text from the image to join.\n\n⏳ **10 Minutos / Minutes**",
        color: 0xFF5555,
        image: { url: 'attachment://challenge.png' },
        footer: { text: `Intentos restantes / Attempts remaining: ${attemptsLeft}` }
    };

    return {
        content: `<@${memberId}>`,
        embeds: [embed],
        files: [attachment],
        components: [row]
    };
}
