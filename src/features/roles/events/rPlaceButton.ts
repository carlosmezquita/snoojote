import { Events, type Interaction } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';

import { config } from '../../../config.js';

const ROLE_ID = config.roles.rPlace;

export const name = Events.InteractionCreate;
export const once = false;

export const execute = async (interaction: Interaction, client: DiscordBot) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'give_rplace2023_role') return;

    if (!interaction.inGuild() || !interaction.member) return;

    const member = await interaction.guild?.members.fetch(interaction.user.id);
    if (!member) return;

    try {
        if (member.roles.cache.has(ROLE_ID)) {
            await member.roles.remove(ROLE_ID);
            client.logger.info('Removed rPlace role from member', {
                userId: member.id,
                guildId: interaction.guildId,
                roleId: ROLE_ID,
            });
            await interaction.reply({ content: 'Rol eliminado correctamente.', ephemeral: true });
        } else {
            await member.roles.add(ROLE_ID);
            client.logger.info('Added rPlace role to member', {
                userId: member.id,
                guildId: interaction.guildId,
                roleId: ROLE_ID,
            });
            await interaction.reply({ content: 'Rol añadido correctamente.', ephemeral: true });
        }
    } catch (error) {
        client.logger.error('Failed to toggle rPlace role', {
            userId: member.id,
            guildId: interaction.guildId,
            roleId: ROLE_ID,
            error,
        });
        await interaction.reply({ content: 'Error al gestionar el rol.', ephemeral: true });
    }
};
