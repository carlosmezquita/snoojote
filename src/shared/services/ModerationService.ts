import { type GuildMember, type TextChannel } from 'discord.js';
import { createErrorEmbed, createWarningEmbed } from '../utils/embeds.js';

export class ModerationService {
    async warn(member: GuildMember, reason: string, channel?: TextChannel): Promise<void> {
        // In a real app, we might store warnings in a DB.
        // For now, we just DM the user and optionally send a message to a channel.

        try {
            await member.send({
                embeds: [
                    createWarningEmbed('Advertencia', `Has recibido una advertencia: ${reason}`),
                ],
            });
        } catch (err) {
            console.error(`Could not DM user ${member.id}:`, err);
        }

        if (channel) {
            await channel.send({
                embeds: [
                    createWarningEmbed(
                        'Usuario Advertido',
                        `${member.toString()} ha sido advertido.\n**Razón:** ${reason}`,
                    ),
                ],
            });
        }
    }

    async kick(member: GuildMember, reason: string, channel?: TextChannel): Promise<void> {
        try {
            await member.send({
                embeds: [
                    createErrorEmbed(
                        'Expulsado',
                        `Has sido expulsado del servidor.\n**Razón:** ${reason}`,
                    ),
                ],
            });
        } catch (err) {
            console.error(`Could not DM user ${member.id}:`, err);
        }

        await member.kick(reason);

        if (channel) {
            await channel.send({
                embeds: [
                    createErrorEmbed(
                        'Usuario Expulsado',
                        `${member.toString()} ha sido expulsado.\n**Razón:** ${reason}`,
                    ),
                ],
            });
        }
    }

    async ban(
        member: GuildMember,
        reason: string,
        durationSeconds: number = 0,
        channel?: TextChannel,
    ): Promise<void> {
        try {
            await member.send({
                embeds: [
                    createErrorEmbed(
                        'Baneado',
                        `Has sido baneado del servidor.\n**Razón:** ${reason}`,
                    ),
                ],
            });
        } catch (err) {
            console.error(`Could not DM user ${member.id}:`, err);
        }

        await member.ban({ reason, deleteMessageSeconds: durationSeconds });

        if (channel) {
            await channel.send({
                embeds: [
                    createErrorEmbed(
                        'Usuario Baneado',
                        `${member.toString()} ha sido baneado.\n**Razón:** ${reason}`,
                    ),
                ],
            });
        }
    }
}

export default new ModerationService();
