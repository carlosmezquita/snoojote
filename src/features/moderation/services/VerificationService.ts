import {
    GuildMember,
    ChannelType,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    TextChannel,
    Guild,
    Interaction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import captchaService from './CaptchaService.js';
import verificationState from './VerificationStateService.js';
import { config } from '../../../config.js';

class VerificationService {
    private readonly SUSPECT_ROLE_ID = config.roles.suspect;
    private readonly MOD_ROLE_ID = config.roles.mod;
    private readonly VERIFIER_CATEGORY_ID = config.channels.verifierCategory;
    private readonly LOG_CHANNEL_ID = config.channels.logs;

    private readonly KICK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    private readonly STALE_CHANNEL_MS = 15 * 60 * 1000; // 15 minutes
    private readonly MAX_ATTEMPTS = 3;

    /**
     * Handles the logic when a suspicious user joins (Trap).
     */
    async handleMemberJoin(member: GuildMember, client: DiscordBot, accountAgeMs: number) {
        const guild = member.guild;

        try {
            await member.roles.add(this.SUSPECT_ROLE_ID);
            await this.sendLog(guild, `🚨 **Nuevo Sospechoso:** <@${member.id}> (${member.user.tag})\n**Cuenta:** ${(accountAgeMs / (1000 * 60 * 60 * 24)).toFixed(1)} días.`, client);

            const channel = await this.createVerificationChannel(guild, member, client);
            if (!channel) return;

            const payload = await this.generateChallengePayload(member.id, this.MAX_ATTEMPTS);
            const msg = await channel.send(payload);

            const state = {
                attempts: 0,
                channelId: channel.id,
                mainMsgId: msg.id,
                warningMsgId: null as string | null,
                timeouts: [] as NodeJS.Timeout[]
            };

            this.setupTimers(state, member, channel, client);
            verificationState.set(member.id, state);

        } catch (error) {
            client.logger.error(`Trap Error for ${member.user.tag}: ${error}`);
        }
    }

    /**
     * Handles interactions (buttons, modals) in the verification channel.
     */
    async handleInteraction(interaction: Interaction, client: DiscordBot) {
        if (!interaction.inGuild() || !interaction.channel || !('name' in interaction.channel) || !interaction.channel.name.startsWith('verify-')) return;

        const userId = interaction.user.id;
        const userState = verificationState.get(userId);

        if (!userState) {
            if (interaction.isRepliable()) {
                await interaction.reply({ content: "⚠️ Error de sesión. Por favor reingresa.", ephemeral: true });
            }
            if (interaction.channelId) {
                this.scheduleVerificationChannelDelete(interaction.channelId, client, 'stale verification session', 10_000, interaction.channel);
            }
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('verify_btn_')) {
            await this.handleVerifyButton(interaction);
        } else if (interaction.isModalSubmit() && interaction.customId.startsWith('verify_modal_')) {
            await this.handleCaptchaSubmit(interaction, userState, userId, client);
        }
    }

    private async handleVerifyButton(interaction: any) {
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

    private async handleCaptchaSubmit(interaction: any, userState: any, userId: string, client: DiscordBot) {
        const correctAnswer = interaction.customId.split('_')[2];
        const userAnswer = interaction.fields.getTextInputValue('captcha_input');

        if (userAnswer.toUpperCase() === correctAnswer.toUpperCase()) {
            await this.handleSuccess(interaction, userState, userId, client);
        } else {
            await this.handleFailure(interaction, userState, userId, client);
        }
    }

    private async handleSuccess(interaction: any, userState: any, userId: string, client: DiscordBot) {
        try {
            if (interaction.member && 'roles' in interaction.member) {
                await interaction.member.roles.remove(this.SUSPECT_ROLE_ID);
            }

            await interaction.reply({ content: "✅ **Verificado / Verified.**", ephemeral: true });
            await this.sendLog(interaction.guild, `🟢 **Verificación Exitosa:** <@${userId}>`, client);

            client.emit('guildMemberVerified', interaction.member as GuildMember);
        } catch (err) {
            client.logger.error(`Verification Success Cleanup Error for ${userId}: ${err}`);
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: "Error de permisos.", ephemeral: true }).catch(() => { });
            }
        } finally {
            this.cleanupVerificationSession(userId, client, 'verification success', 3000, interaction.channel);
        }
    }

    private async handleFailure(interaction: any, userState: any, userId: string, client: DiscordBot) {
        userState.attempts++;
        const attemptsLeft = this.MAX_ATTEMPTS - userState.attempts;
        await this.sendLog(interaction.guild, `⚠️ **Fallo:** <@${userId}>. Quedan ${attemptsLeft} intentos.`, client);

        if (userState.attempts >= this.MAX_ATTEMPTS) {
            try {
                if (interaction.member && 'kick' in interaction.member) {
                    await interaction.member.kick("Falló 3 veces.");
                }
                await this.sendLog(interaction.guild, `🚫 **Expulsado (Intentos):** <@${userId}> falló 3 veces.`, client);
                await interaction.reply({ content: "❌ **Expulsado / Kicked**", ephemeral: true });
            } catch (e) {
                client.logger.error(`Verification Failure Cleanup Error for ${userId}: ${e}`);
                if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: "No pude expulsar al usuario. Revisa permisos.", ephemeral: true }).catch(() => { });
                }
            } finally {
                this.cleanupVerificationSession(userId, client, 'verification failed max attempts', 3000, interaction.channel);
            }
        } else {
            // Retry logic
            await interaction.deferUpdate();
            try {
                if (interaction.channel && interaction.channel.isTextBased()) {
                    const mainMsg = await interaction.channel.messages.fetch(userState.mainMsgId);
                    const newPayload = await this.generateChallengePayload(interaction.user.id, attemptsLeft);
                    await mainMsg.edit(newPayload as any);
                    await interaction.followUp({ content: `❌ **Incorrecto / Incorrect.**`, ephemeral: true });
                }
            } catch (e) {
                // Fallback if edit fails
                if (interaction.channel && interaction.channel.isTextBased()) {
                    const newPayload = await this.generateChallengePayload(interaction.user.id, attemptsLeft);
                    const newMsg = await interaction.channel.send(newPayload as any);
                    userState.mainMsgId = newMsg.id;
                    verificationState.set(userId, userState);
                }
            }
        }
    }

    private async createVerificationChannel(guild: Guild, member: GuildMember, client: DiscordBot) {
        return await guild.channels.create({
            name: `verify-${member.user.username.substring(0, 10)}`,
            type: ChannelType.GuildText,
            parent: this.VERIFIER_CATEGORY_ID,
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
                    id: this.MOD_ROLE_ID,
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
    }

    private setupTimers(state: any, member: GuildMember, channel: TextChannel, client: DiscordBot) {
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
            const currentMember = await member.guild.members.fetch(member.id).catch(() => null);
            try {
                if (currentMember && currentMember.roles.cache.has(this.SUSPECT_ROLE_ID)) {
                    await currentMember.kick("Tiempo agotado.");
                    await this.sendLog(member.guild, `💀 **Expulsado (Timeout):** <@${member.id}>`, client);
                } else if (currentMember) {
                    await this.sendLog(member.guild, `🧹 **Canal de verificación limpiado:** <@${member.id}> ya no tiene el rol sospechoso.`, client);
                } else {
                    await this.sendLog(member.guild, `🧹 **Canal de verificación limpiado:** <@${member.id}> ya no está en el servidor.`, client);
                }
            } catch (error) {
                client.logger.error(`Verification Timeout Error for ${member.id}: ${error}`);
            } finally {
                this.cleanupVerificationSession(member.id, client, 'verification timeout', 0, channel);
            }
        }, this.KICK_TIMEOUT_MS);

        state.timeouts.push(kickTid);
    }

    public async cleanupStaleVerificationChannels(client: DiscordBot) {
        const now = Date.now();

        for (const guild of client.guilds.cache.values()) {
            try {
                const channels = await guild.channels.fetch();

                for (const channel of channels.values()) {
                    if (
                        !channel ||
                        channel.type !== ChannelType.GuildText ||
                        !channel.name.startsWith('verify-') ||
                        channel.parentId !== this.VERIFIER_CATEGORY_ID
                    ) {
                        continue;
                    }

                    const channelAge = now - channel.createdTimestamp;
                    if (channelAge < this.STALE_CHANNEL_MS) continue;

                    await this.deleteVerificationChannel(channel.id, client, 'stale verification channel after restart', channel);
                }
            } catch (error) {
                client.logger.error(`Stale Verification Cleanup Error for ${guild.id}: ${error}`);
            }
        }
    }

    public async generateChallengePayload(memberId: string, attemptsLeft: number) {
        const captchaText = captchaService.generateCaptchaText();
        const imageBuffer = await captchaService.drawCaptchaImage(captchaText);
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

    private async sendLog(guild: Guild, text: string, client: DiscordBot) {
        try {
            const channel = await guild.channels.fetch(this.LOG_CHANNEL_ID).catch(() => null) as TextChannel;
            if (channel) await channel.send(`🛡️ **Seguridad:** ${text}`);
        } catch (err) { client.logger.error(`Log Error: ${err}`); }
    }

    private cleanupVerificationSession(userId: string, client: DiscordBot, reason: string, delayMs: number, channel?: any) {
        const state = verificationState.get(userId);
        const channelId = state?.channelId ?? channel?.id;

        if (state) {
            state.timeouts.forEach((t: NodeJS.Timeout) => clearTimeout(t));
        }
        verificationState.delete(userId);

        if (channelId) {
            this.scheduleVerificationChannelDelete(channelId, client, reason, delayMs, channel);
        }
    }

    private scheduleVerificationChannelDelete(channelId: string, client: DiscordBot, reason: string, delayMs: number, channel?: any) {
        const deleteChannel = async () => {
            await this.deleteVerificationChannel(channelId, client, reason, channel);
        };

        if (delayMs > 0) {
            setTimeout(() => {
                void deleteChannel();
            }, delayMs);
            return;
        }

        void deleteChannel();
    }

    private async deleteVerificationChannel(channelId: string, client: DiscordBot, reason: string, channel?: any) {
        try {
            const target = channel ?? await client.channels.fetch(channelId).catch(() => null);

            if (!target) {
                client.logger.warn(`Verification Cleanup: channel ${channelId} already missing (${reason}).`);
                return;
            }

            if (typeof target.delete !== 'function') {
                client.logger.warn(`Verification Cleanup: channel ${channelId} is not deletable (${reason}).`);
                return;
            }

            await target.delete(`Verification cleanup: ${reason}`);
            client.logger.info(`Verification Cleanup: deleted channel ${channelId} (${reason}).`);
        } catch (error) {
            client.logger.error(`Verification Cleanup: failed to delete channel ${channelId} (${reason}): ${error}`);
        }
    }
}

export default new VerificationService();
