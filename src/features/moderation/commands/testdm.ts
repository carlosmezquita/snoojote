import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    type GuildMember,
    PermissionFlagsBits,
} from 'discord.js';
import { DMService, DMType } from '../../../shared/services/DMService.js';
import { isStaff } from '../../../shared/utils/permissions.js';

export const data = new SlashCommandBuilder()
    .setName('testdm')
    .setDescription('Prueba el servicio de mensajes directos')
    .addStringOption((option) =>
        option
            .setName('type')
            .setDescription('El tipo de mensaje directo que se enviará')
            .setRequired(true)
            .addChoices(
                { name: 'Info', value: DMType.Info },
                { name: 'Success', value: DMType.Success },
                { name: 'Warning', value: DMType.Warning },
                { name: 'Sanction', value: DMType.Sanction },
                { name: 'Gift', value: DMType.Gift },
                { name: 'Neutral', value: DMType.Neutral },
            ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
    if (interaction.guild) {
        const member =
            (interaction.member as GuildMember) ||
            (await interaction.guild.members.fetch(interaction.user.id));

        if (!isStaff(member)) {
            await interaction.reply({ content: 'No tienes permiso.', ephemeral: true });
            return;
        }
    }

    const type = interaction.options.getString('type') as DMType;

    await interaction.deferReply({ ephemeral: true });

    const result = await DMService.sendWithFallback({
        user: interaction.user,
        type: type,
        title: `Prueba de MD: ${type}`,
        description: `Este es un mensaje de prueba para el tipo de notificación **${type}**.`,
        footer: 'Sistema de pruebas de Snoojote',
    });

    if (result.dmSent) {
        await interaction.editReply(`✅ Te he enviado un MD de tipo **${type}**.`);
    } else if (result.fallbackSent) {
        await interaction.editReply(
            `✅ Tenías los MD cerrados, así que he publicado la prueba **${type}** en el canal del bot.`,
        );
    } else {
        await interaction.editReply(`❌ No se pudo enviar el MD ni el mensaje alternativo.`);
    }
}
