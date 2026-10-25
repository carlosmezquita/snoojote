import { Events, type Interaction } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import { isSafeSelfAssignableRole } from '../../../shared/utils/roles.js';
import { Cooldown } from '../../../shared/services/Cooldown.js';

const cooldown = new Cooldown();
export const name = Events.InteractionCreate;
export const once = false;
export const execute = async (interaction: Interaction, client: DiscordBot) => {
    if (
        !interaction.isButton() ||
        interaction.customId !== 'give_rplace2023_role' ||
        !interaction.guild
    )
        return;
    if (!cooldown.acquire(`${interaction.guildId}:${interaction.user.id}`, 2000)) {
        await interaction.reply({
            content: 'Espera unos segundos antes de volver a cambiar el rol.',
            ephemeral: true,
        });
        return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
        const roleId = config.roles.rPlace;
        const role =
            interaction.guild.roles.cache.get(roleId) ??
            (await interaction.guild.roles.fetch(roleId));
        if (!isSafeSelfAssignableRole(role)) {
            await interaction.editReply('Este rol no está disponible. Contacta con el equipo.');
            return;
        }
        const member = await interaction.guild.members.fetch({
            user: interaction.user.id,
            force: true,
        });
        const removing = member.roles.cache.has(roleId);
        if (removing) await member.roles.remove(roleId);
        else await member.roles.add(roleId);
        await interaction.editReply(
            removing ? 'Rol eliminado correctamente.' : 'Rol añadido correctamente.',
        );
    } catch (error) {
        client.logger.error('Failed to toggle rPlace role', {
            userId: interaction.user.id,
            guildId: interaction.guildId,
            error,
        });
        await interaction.editReply('Error al gestionar el rol.');
    }
};
