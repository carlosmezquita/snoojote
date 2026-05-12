import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    PermissionsBitField,
    GuildMember,
} from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import { postDailyWord } from '../../dailyWord/events/dailyWord.js';

import { isStaff } from '../../../shared/utils/permissions.js';

export const data = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Comandos administrativos')
    .addStringOption((option) =>
        option
            .setName('accion')
            .setDescription('Selecciona la acción a realizar')
            .setRequired(true)
            .addChoices({ name: 'Forzar Palabra del Día', value: 'force-daily-word' }),
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: 'Este comando solo puede usarse en un servidor.',
            ephemeral: true,
        });
        return;
    }

    const member = (interaction.member as GuildMember) || 
        await interaction.guild!.members.fetch(interaction.user.id);

    if (!isStaff(member)) {
        await interaction.reply({
            content: 'No tienes permiso para usar este comando.',
            ephemeral: true,
        });
        return;
    }

    const action = interaction.options.getString('accion', true);

    if (action === 'force-daily-word') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const word = await postDailyWord(client);
            await interaction.editReply({
                content: `✅ Se ha publicado la Palabra del Día: **${word}**`,
            });
        } catch (error) {
            client.logger.error(`Admin Force Word Error: ${error}`);
            await interaction.editReply({
                content: `❌ Error al publicar la Palabra del Día. Revisa los logs.`,
            });
        }
    }
};
