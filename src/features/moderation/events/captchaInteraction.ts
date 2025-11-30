import { Events, Interaction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonStyle, ButtonBuilder, AttachmentBuilder, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import verificationState from '../utils/verificationState.js';
import { generateChallengePayload } from './memberJoinTrap.js';

import { config } from '../../../config.js';

const SUSPECT_ROLE_ID = config.roles.suspect;
const LOG_CHANNEL_ID = config.channels.logs;
const MAX_ATTEMPTS = 3;

export const name = Events.InteractionCreate;
export const once = false;

export const execute = async (interaction: Interaction, client: DiscordBot) => {
    if (!interaction.inGuild() || !interaction.channel || !('name' in interaction.channel) || !interaction.channel.name.startsWith('verify-')) return;

    const userId = interaction.user.id;
    const userState = verificationState.get(userId);

    if (!userState && (interaction.isButton() || interaction.isModalSubmit())) {
        if (interaction.isRepliable()) {
            await interaction.reply({ content: "⚠️ Error de sesión. Por favor reingresa.", ephemeral: true });
        }
        return;
    }

    if (!userState) return;

    if (interaction.isButton() && interaction.customId.startsWith('verify_btn_')) {
        const correctAnswer = interaction.customId.split('_')[2];
        const modal = new ModalBuilder()
            .setCustomId(`verify_modal_${correctAnswer}`)
            .setTitle('Seguridad / Security');

        const input = new TextInputBuilder()
            .setCustomId('captcha_input')
            .setLabel("Código / Code")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(6);

        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('verify_modal_')) {
        const correctAnswer = interaction.customId.split('_')[2];
        const userAnswer = interaction.fields.getTextInputValue('captcha_input');

        if (userAnswer.toUpperCase() === correctAnswer.toUpperCase()) {
            // SUCCESS
            try {
                userState.timeouts.forEach(t => clearTimeout(t));
                if (interaction.member && 'roles' in interaction.member) {
                    // @ts-ignore
                    await interaction.member.roles.remove(SUSPECT_ROLE_ID);
                }
                verificationState.delete(userId);

                await interaction.reply({ content: "✅ **Verificado / Verified.**", ephemeral: true });
                await sendLog(interaction.guild, `🟢 **Verificación Exitosa:** <@${userId}>`, client);

                setTimeout(() => interaction.channel?.delete().catch(() => { }), 3000);
            } catch (err) {
                await interaction.reply({ content: "Error de permisos.", ephemeral: true });
            }
        } else {
            // FAILURE
            userState.attempts++;
            const attemptsLeft = MAX_ATTEMPTS - userState.attempts;
            await sendLog(interaction.guild, `⚠️ **Fallo:** <@${userId}>. Quedan ${attemptsLeft} intentos.`, client);

            if (userState.attempts >= MAX_ATTEMPTS) {
                // KICK
                userState.timeouts.forEach(t => clearTimeout(t));
                try {
                    if (interaction.member && 'kick' in interaction.member) {
                        // @ts-ignore
                        await interaction.member.kick("Falló 3 veces.");
                    }
                    await sendLog(interaction.guild, `🚫 **Expulsado (Intentos):** <@${userId}> falló 3 veces.`, client);
                    await interaction.reply({ content: "❌ **Expulsado / Kicked**", ephemeral: true });
                    setTimeout(() => interaction.channel?.delete().catch(() => { }), 3000);
                    verificationState.delete(userId);
                } catch (e) { }
            } else {
                // RETRY: EDIT MAIN MESSAGE
                await interaction.deferUpdate();
                try {
                    if (interaction.channel && interaction.channel.isTextBased()) {
                        const mainMsg = await interaction.channel.messages.fetch(userState.mainMsgId);
                        const newPayload = await generateChallengePayload(interaction.user.id, attemptsLeft);
                        await mainMsg.edit(newPayload as any);
                        await interaction.followUp({ content: `❌ **Incorrecto / Incorrect.**`, ephemeral: true });
                    }
                } catch (e) {
                    if (interaction.channel && interaction.channel.isTextBased()) {
                        const newPayload = await generateChallengePayload(interaction.user.id, attemptsLeft);
                        const newMsg = await interaction.channel.send(newPayload as any);
                        userState.mainMsgId = newMsg.id;
                        verificationState.set(userId, userState);
                    }
                }
            }
        }
    }
};

async function sendLog(guild: any, text: string, client: DiscordBot) {
    try {
        const channel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null) as TextChannel;
        if (channel) await channel.send(`🛡️ **Seguridad:** ${text}`);
    } catch (err) { client.logger.error(`Log Error: ${err}`); }
}
