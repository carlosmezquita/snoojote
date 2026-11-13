import { isWorking } from '../../../core/restartDispatch.js';
import { claimAnswer } from './verificationJournal.js';
import {
    type GuildMember,
    ChannelType,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    type TextChannel,
    type Guild,
    type Interaction,
    type ModalSubmitInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import captchaService from './CaptchaService.js';
import verificationState, { type VerificationStateService } from './VerificationStateService.js';
import { type VerificationState } from '../types/verification.js';
import { randomUUID } from 'crypto';
import { config } from '../../../config.js';

import {
    discardVerification,
    membershipKey,
    readVerification,
    saveVerification,
} from './verificationJournal.js';

export class VerificationService {
    private readonly starting = new Set<string>();
    constructor(
        private readonly state: VerificationStateService = verificationState,
        private readonly captcha: Pick<
            typeof captchaService,
            'generateCaptchaText' | 'drawCaptchaImage'
        > = captchaService,
        private readonly now: () => number = Date.now,
    ) {}

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
    async handleMemberJoin(
        member: GuildMember,
        client: DiscordBot,
        accountAgeMs: number,
        manual = false,
    ) {
        const guild = member.guild;
        const sessionKey = `${guild.id}:${member.id}`;
        const key = membershipKey(member);
        const active = this.state.get(member.id, guild.id);
        if (active && active.membership !== key)
            this.cleanupVerificationSession(member.id, guild.id, client, 'previous membership', 0);
        if (this.state.has(member.id, guild.id) || this.starting.has(sessionKey)) return;
        const record = readVerification(key);
        if (!manual && record?.status === 'completed') return;
        this.starting.add(sessionKey);

        try {
            if (!record || record.status === 'completed') saveVerification(key);
            if (record?.challenge && isWorking('verify:' + member.id) && !manual)
                throw new Error('Verification interaction is still completing');
            const saved: VerificationState | undefined = record?.challenge
                ? JSON.parse(record.challenge)
                : undefined;
            if (saved && !member.roles.cache.has(this.SUSPECT_ROLE_ID)) {
                // A moderator or a successful answer already removed the restriction.
                saveVerification(key, undefined, true);
                return;
            }
            if (saved && saved.challengeId && saved.mainMsgId) {
                const channel = await guild.channels
                    .fetch(saved.channelId)
                    .catch((error: unknown) => {
                        if (
                            error &&
                            typeof error === 'object' &&
                            'code' in error &&
                            error.code === 10003
                        )
                            return null;
                        throw error;
                    });
                if (channel?.type === ChannelType.GuildText) {
                    saved.membership = key;
                    saved.processing = false;
                    saved.timeouts = [];
                    this.state.set(member.id, saved);
                    this.setupTimers(saved, member, channel, client);
                    return;
                }
            }
            await member.roles.add(this.SUSPECT_ROLE_ID);
            client.logger.info('Assigned suspect role for verification', {
                userId: member.id,
                userTag: member.user.tag,
                guildId: guild.id,
                roleId: this.SUSPECT_ROLE_ID,
            });
            await this.sendLog(
                guild,
                `🚨 **Nuevo Sospechoso:** <@${member.id}> (${member.user.tag})\n**Cuenta:** ${(accountAgeMs / (1000 * 60 * 60 * 24)).toFixed(1)} días.`,
                client,
            );

            const channel = await this.createVerificationChannel(guild, member, client);
            if (!channel) return;

            const state: VerificationState = {
                guildId: guild.id,
                membership: key,
                challengeId: '',
                answer: '',
                expiresAt: saved?.expiresAt ?? this.now() + this.KICK_TIMEOUT_MS,
                processing: false,
                attempts: saved?.attempts ?? 0,
                channelId: channel.id,
                mainMsgId: '',
                warningMsgId: null as string | null,
                timeouts: [] as NodeJS.Timeout[],
            };

            const payload = await this.generateChallengePayload(
                member.id,
                this.MAX_ATTEMPTS,
                state,
            );
            const msg = await channel.send(payload);
            state.mainMsgId = msg.id;
            saveVerification(key, state);
            this.setupTimers(state, member, channel, client);
            this.state.set(member.id, state);
        } catch (error) {
            client.logger.error('Failed to start verification trap flow', {
                userId: member.id,
                userTag: member.user.tag,
                guildId: guild.id,
                accountAgeDays: Number((accountAgeMs / (1000 * 60 * 60 * 24)).toFixed(1)),
                error,
            });
            throw error;
        } finally {
            this.starting.delete(sessionKey);
        }
    }

    /**
     * Handles interactions (buttons, modals) in the verification channel.
     */
    async handleInteraction(interaction: Interaction, client: DiscordBot) {
        if (
            !interaction.inGuild() ||
            !interaction.guild ||
            !interaction.channel ||
            !('name' in interaction.channel) ||
            !interaction.channel.name.startsWith('verify-')
        )
            return;

        if (!interaction.isButton() && !interaction.isModalSubmit()) return;
        if (
            !interaction.customId.startsWith('verify_btn_') &&
            !interaction.customId.startsWith('verify_modal_')
        )
            return;
        const userId = interaction.user.id;
        let userState = this.state.get(userId, interaction.guildId!);
        // The interaction can land on the listener that did not issue the CAPTCHA.
        // Read its current generation before accepting a button or a modal.
        if (interaction.member && 'joinedTimestamp' in interaction.member) {
            const key = membershipKey(interaction.member as GuildMember);
            const row = readVerification(key);
            if (row?.status === 'pending' && row.challenge) {
                const saved: VerificationState = JSON.parse(row.challenge);
                if (userState?.membership === key) {
                    Object.assign(userState, saved);
                } else {
                    userState = { ...saved, membership: key, processing: false, timeouts: [] };
                }
            } else userState = undefined;
        }
        const expectedId = `${interaction.isButton() ? 'verify_btn_' : 'verify_modal_'}${userState?.challengeId}`;
        if (
            !userState ||
            userState.channelId !== interaction.channelId ||
            userState.expiresAt <= this.now() ||
            userState.processing ||
            userState.attempts >= this.MAX_ATTEMPTS ||
            !userState.challengeId ||
            interaction.customId !== expectedId
        ) {
            await interaction.reply({
                content: 'La verificación ha caducado o no corresponde a esta sesión.',
                ephemeral: true,
            });
            return;
        }
        if (interaction.isButton()) {
            const modal = new ModalBuilder()
                .setCustomId(`verify_modal_${userState.challengeId}`)
                .setTitle('Seguridad / Security');
            const input = new TextInputBuilder()
                .setCustomId('captcha_input')
                .setLabel('Código / Code')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(6);
            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
            await interaction.showModal(modal);
            return;
        }
        if (!interaction.isModalSubmit()) return;
        if (userState.membership && !claimAnswer(userState.membership, userState.challengeId)) {
            await interaction.reply({
                content: 'La verificación ha caducado o ya se está procesando.',
                ephemeral: true,
            });
            return;
        }
        const answer = interaction.fields.getTextInputValue('captcha_input');
        if (answer.toUpperCase() === userState.answer.toUpperCase()) {
            userState.processing = true;
            await this.handleSuccess(
                interaction as ModalSubmitInteraction<'cached'>,
                userState,
                userId,
                client,
            );
        } else {
            userState.challengeId = ''; // Consume before awaiting; stale modals cannot spend attempts.
            await this.handleFailure(
                interaction as ModalSubmitInteraction<'cached'>,
                userState,
                userId,
                client,
            );
        }
    }

    private async handleSuccess(
        interaction: ModalSubmitInteraction<'cached'>,
        userState: VerificationState,
        userId: string,
        client: DiscordBot,
    ) {
        let verified = false;
        try {
            await interaction.deferReply({ ephemeral: true });
            if (interaction.member && !Array.isArray(interaction.member.roles)) {
                await interaction.member.roles.remove(this.SUSPECT_ROLE_ID);
            } else {
                throw new Error('Verification member is unavailable');
            }
            if (userState.membership) saveVerification(userState.membership, undefined, true);
            verified = true;
            userState.answer = '';

            await interaction.editReply({ content: '✅ **Verificado / Verified.**' });
            await this.sendLog(
                interaction.guild,
                `🟢 **Verificación Exitosa:** <@${userId}>`,
                client,
            );

            client.emit('guildMemberVerified', interaction.member as GuildMember);
        } catch (err) {
            client.logger.error('Verification success cleanup failed', {
                userId,
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                error: err,
            });
            if (interaction.deferred) {
                await interaction
                    .editReply({
                        content: 'Error de permisos. Inténtalo de nuevo o contacta con el equipo.',
                    })
                    .catch((error: unknown) => {
                        client.logger.warn('Failed to edit verification error response', {
                            userId,
                            error,
                        });
                    });
            } else if (interaction.isRepliable() && !interaction.replied) {
                await interaction
                    .reply({ content: 'Error de permisos.', ephemeral: true })
                    .catch((replyError: unknown) => {
                        client.logger.warn('Failed to send verification success error reply', {
                            userId,
                            guildId: interaction.guildId,
                            channelId: interaction.channelId,
                            error: replyError,
                        });
                    });
            }
        } finally {
            if (verified)
                this.cleanupVerificationSession(
                    userId,
                    interaction.guildId,
                    client,
                    'verification success',
                    3000,
                    interaction.channel as TextChannel,
                );
            else {
                userState.processing = false;
                if (userState.membership) saveVerification(userState.membership, userState);
            }
        }
    }

    private async handleFailure(
        interaction: ModalSubmitInteraction<'cached'>,
        userState: VerificationState,
        userId: string,
        client: DiscordBot,
    ) {
        // Acknowledge before logging, rendering a CAPTCHA, or making moderation requests.
        userState.attempts++;
        if (userState.membership) saveVerification(userState.membership, userState);
        await interaction.deferUpdate();
        const attemptsLeft = this.MAX_ATTEMPTS - userState.attempts;
        client.logger.info('Verification challenge failed', {
            userId,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            attempts: userState.attempts,
            attemptsLeft,
        });
        await this.sendLog(
            interaction.guild,
            `⚠️ **Fallo:** <@${userId}>. Quedan ${attemptsLeft} intentos.`,
            client,
        );

        if (userState.attempts >= this.MAX_ATTEMPTS) {
            try {
                if (interaction.member && 'kick' in interaction.member) {
                    await interaction.member.kick('Falló 3 veces.');
                    if (userState.membership) discardVerification(userState.membership);
                }
                await this.sendLog(
                    interaction.guild,
                    `🚫 **Expulsado (Intentos):** <@${userId}> falló 3 veces.`,
                    client,
                );
                await interaction.followUp({
                    content: '❌ **Expulsado / Kicked**',
                    ephemeral: true,
                });
            } catch (e) {
                client.logger.error('Verification max-attempt cleanup failed', {
                    userId,
                    guildId: interaction.guildId,
                    channelId: interaction.channelId,
                    error: e,
                });
                if (interaction.isRepliable()) {
                    await interaction
                        .followUp({
                            content: 'No pude expulsar al usuario. Revisa permisos.',
                            ephemeral: true,
                        })
                        .catch((replyError: unknown) => {
                            client.logger.warn('Failed to send verification failure error reply', {
                                userId,
                                guildId: interaction.guildId,
                                channelId: interaction.channelId,
                                error: replyError,
                            });
                        });
                }
            } finally {
                this.cleanupVerificationSession(
                    userId,
                    interaction.guildId,
                    client,
                    'verification failed max attempts',
                    3000,
                    interaction.channel as TextChannel,
                );
            }
        } else {
            // Retry logic
            try {
                if (interaction.channel && interaction.channel.isTextBased()) {
                    const mainMsg = await interaction.channel.messages.fetch(userState.mainMsgId);
                    const newPayload = await this.generateChallengePayload(
                        interaction.user.id,
                        attemptsLeft,
                        userState,
                    );
                    await mainMsg.edit(newPayload);
                    if (userState.membership) saveVerification(userState.membership, userState);
                    await interaction.followUp({
                        content: `❌ **Incorrecto / Incorrect.**`,
                        ephemeral: true,
                    });
                }
            } catch (e) {
                client.logger.warn('Failed to update verification challenge message', {
                    userId,
                    guildId: interaction.guildId,
                    channelId: interaction.channelId,
                    messageId: userState.mainMsgId,
                    error: e,
                });
                // Fallback if edit fails
                if (interaction.channel && interaction.channel.isTextBased()) {
                    const newPayload = await this.generateChallengePayload(
                        interaction.user.id,
                        attemptsLeft,
                        userState,
                    );
                    try {
                        const newMsg = await interaction.channel.send(newPayload);
                        userState.mainMsgId = newMsg.id;
                        if (userState.membership) saveVerification(userState.membership, userState);
                        this.state.set(userId, userState);
                    } catch (sendError) {
                        client.logger.error('Failed to send replacement verification challenge', {
                            userId,
                            guildId: interaction.guildId,
                            channelId: interaction.channelId,
                            error: sendError,
                        });
                    }
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
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    id: client.user!.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
                {
                    id: this.MOD_ROLE_ID,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                    ],
                },
                {
                    id: member.id,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.AddReactions,
                        PermissionFlagsBits.CreatePublicThreads,
                        PermissionFlagsBits.CreatePrivateThreads,
                    ],
                },
            ],
        });
    }

    private setupTimers(
        state: VerificationState,
        member: GuildMember,
        channel: TextChannel,
        client: DiscordBot,
    ) {
        const scheduleWarning = (ms: number, text: string) => {
            ms += state.expiresAt - this.KICK_TIMEOUT_MS - this.now();
            if (ms <= 0) return;
            const tid = setTimeout(async () => {
                try {
                    if (state.warningMsgId) {
                        const existingMsg = await channel.messages
                            .fetch(state.warningMsgId)
                            .catch((error) => {
                                client.logger.warn('Failed to fetch verification warning message', {
                                    userId: member.id,
                                    guildId: member.guild.id,
                                    channelId: channel.id,
                                    messageId: state.warningMsgId,
                                    error,
                                });
                                return null;
                            });
                        if (existingMsg) {
                            await existingMsg.delete().catch((error) => {
                                client.logger.warn(
                                    'Failed to delete previous verification warning message',
                                    {
                                        userId: member.id,
                                        guildId: member.guild.id,
                                        channelId: channel.id,
                                        messageId: existingMsg.id,
                                        error,
                                    },
                                );
                            });
                        }
                    }
                    const newMsg = await channel.send(`<@${member.id}> ⏳ **${text}**`);
                    state.warningMsgId = newMsg.id;
                } catch (e) {
                    client.logger.error('Verification timer failed', {
                        userId: member.id,
                        guildId: member.guild.id,
                        channelId: channel.id,
                        error: e,
                    });
                }
            }, ms);
            state.timeouts.push(tid);
        };

        scheduleWarning(2 * 60 * 1000, 'Quedan 8 minutos / 8 minutes remaining');
        scheduleWarning(4 * 60 * 1000, 'Quedan 6 minutos / 6 minutes remaining');
        scheduleWarning(6 * 60 * 1000, 'Quedan 4 minutos / 4 minutes remaining');
        scheduleWarning(8 * 60 * 1000, 'Quedan 2 minutos / 2 minutes remaining');
        scheduleWarning(9.5 * 60 * 1000, '⚠️ **30 segundos restantes / 30 seconds remaining!**');

        const expire = async () => {
            if (this.state.get(member.id, member.guild.id) !== state) return;
            if (isWorking('verify:' + member.id) || state.processing) {
                state.timeouts.push(setTimeout(expire, 1000));
                return;
            }
            if (state.membership && readVerification(state.membership)?.status !== 'pending') {
                this.cleanupVerificationSession(
                    member.id,
                    member.guild.id,
                    client,
                    'verification already finished',
                    0,
                    channel,
                );
                return;
            }
            const currentMember = await member.guild.members
                .fetch({ user: member.id, force: true })
                .catch((error) => {
                    client.logger.warn('Failed to fetch member for verification timeout', {
                        userId: member.id,
                        guildId: member.guild.id,
                        error,
                    });
                    return null;
                });
            try {
                if (this.state.get(member.id, member.guild.id) !== state || state.processing)
                    return;
                if (
                    currentMember &&
                    membershipKey(currentMember) === state.membership &&
                    currentMember.roles.cache.has(this.SUSPECT_ROLE_ID)
                ) {
                    await currentMember.kick('Tiempo agotado.');
                    if (state.membership) discardVerification(state.membership);
                    await this.sendLog(
                        member.guild,
                        `💀 **Expulsado (Timeout):** <@${member.id}>`,
                        client,
                    );
                } else if (currentMember) {
                    await this.sendLog(
                        member.guild,
                        `🧹 **Canal de verificación limpiado:** <@${member.id}> ya no tiene el rol sospechoso.`,
                        client,
                    );
                } else {
                    await this.sendLog(
                        member.guild,
                        `🧹 **Canal de verificación limpiado:** <@${member.id}> ya no está en el servidor.`,
                        client,
                    );
                }
            } catch (error) {
                client.logger.error('Verification timeout handling failed', {
                    userId: member.id,
                    guildId: member.guild.id,
                    channelId: channel.id,
                    error,
                });
            } finally {
                if (this.state.get(member.id, member.guild.id) === state && !state.processing)
                    this.cleanupVerificationSession(
                        member.id,
                        member.guild.id,
                        client,
                        'verification timeout',
                        0,
                        channel,
                    );
            }
        };
        const kickTid = setTimeout(
            expire,
            state.attempts >= this.MAX_ATTEMPTS ? 0 : Math.max(0, state.expiresAt - this.now()),
        );

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

                    await this.deleteVerificationChannel(
                        channel.id,
                        client,
                        'stale verification channel after restart',
                        channel,
                    );
                }
            } catch (error) {
                client.logger.error('Stale verification cleanup failed for guild', {
                    guildId: guild.id,
                    guildName: guild.name,
                    error,
                });
            }
        }
    }

    public async generateChallengePayload(
        memberId: string,
        attemptsLeft: number,
        state: VerificationState,
    ) {
        const captchaText = this.captcha.generateCaptchaText();
        state.challengeId = randomUUID();
        state.answer = captchaText;
        const imageBuffer = await this.captcha.drawCaptchaImage(captchaText);
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'challenge.png' });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`verify_btn_${state.challengeId}`)
                .setLabel('Verificar / Verify')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🔒'),
        );

        const embed = {
            title: '⚠️ Verificación Requerida / Verification Required',
            description:
                '**ES:** Escriba el texto de la imagen para entrar.\n**EN:** Enter the text from the image to join.\n\n⏳ **10 Minutos / Minutes**',
            color: 0xff5555,
            image: { url: 'attachment://challenge.png' },
            footer: { text: `Intentos restantes / Attempts remaining: ${attemptsLeft}` },
        };

        return {
            content: `<@${memberId}>`,
            embeds: [embed],
            files: [attachment],
            components: [row],
        };
    }

    private async sendLog(guild: Guild, text: string, client: DiscordBot) {
        try {
            const channel = await guild.channels.fetch(this.LOG_CHANNEL_ID).catch((error) => {
                client.logger.warn('Failed to fetch verification log channel', {
                    guildId: guild.id,
                    logChannelId: this.LOG_CHANNEL_ID,
                    error,
                });
                return null;
            });
            if (channel && channel.isTextBased()) {
                await channel.send(`🛡️ **Seguridad:** ${text}`);
            } else {
                client.logger.warn('Verification log channel is unavailable or not text-based', {
                    guildId: guild.id,
                    logChannelId: this.LOG_CHANNEL_ID,
                });
            }
        } catch (err) {
            client.logger.error('Failed to send verification log message', {
                guildId: guild.id,
                logChannelId: this.LOG_CHANNEL_ID,
                error: err,
            });
        }
    }

    private cleanupVerificationSession(
        userId: string,
        guildId: string,
        client: DiscordBot,
        reason: string,
        delayMs: number,
        channel?: TextChannel,
    ) {
        const state = this.state.get(userId, guildId);
        const channelId = state?.channelId ?? channel?.id;

        if (state) {
            state.timeouts.forEach((t: NodeJS.Timeout) => clearTimeout(t));
        }
        this.state.delete(userId, guildId);

        if (channelId) {
            this.scheduleVerificationChannelDelete(channelId, client, reason, delayMs, channel);
        }
    }

    private scheduleVerificationChannelDelete(
        channelId: string,
        client: DiscordBot,
        reason: string,
        delayMs: number,
        channel?: TextChannel,
    ) {
        const deleteChannel = async () => {
            await this.deleteVerificationChannel(channelId, client, reason, channel);
        };

        if (delayMs > 0) {
            const timer = setTimeout(() => {
                void deleteChannel();
            }, delayMs);
            timer.unref();
            return;
        }

        void deleteChannel();
    }

    private async deleteVerificationChannel(
        channelId: string,
        client: DiscordBot,
        reason: string,
        channel?: TextChannel,
    ) {
        try {
            const target =
                channel ??
                (await client.channels.fetch(channelId).catch((error) => {
                    client.logger.warn('Failed to fetch verification channel for cleanup', {
                        channelId,
                        reason,
                        error,
                    });
                    return null;
                }));

            if (!target) {
                client.logger.warn('Verification cleanup skipped because channel is missing', {
                    channelId,
                    reason,
                });
                return;
            }

            if (!('delete' in target) || typeof target.delete !== 'function') {
                client.logger.warn(
                    'Verification cleanup skipped because channel is not deletable',
                    {
                        channelId,
                        reason,
                    },
                );
                return;
            }

            await target.delete(`Verification cleanup: ${reason}`);
            client.logger.info('Verification channel deleted during cleanup', {
                channelId,
                reason,
            });
        } catch (error) {
            client.logger.error('Failed to delete verification channel during cleanup', {
                channelId,
                reason,
                error,
            });
        }
    }
}

export default new VerificationService();
