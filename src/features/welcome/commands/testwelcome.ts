import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    type GuildMember,
    PermissionFlagsBits,
} from 'discord.js';
import { DMService } from '../../../shared/services/DMService.js';
import { isStaff } from '../../../shared/utils/permissions.js';

export const data = new SlashCommandBuilder()
    .setName('testwelcome')
    .setDescription('Prueba el mensaje directo de bienvenida')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) return;

    const member =
        (interaction.member as GuildMember) ||
        (await interaction.guild!.members.fetch(interaction.user.id));

    if (!isStaff(member)) {
        await interaction.reply({ content: 'No tienes permiso.', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const username = interaction.user.username.replace(/_/g, '\\_');

    // Emit the custom event to simulate a verified member (testing the channel welcome)
    if (member) {
        interaction.client.emit('guildMemberVerified', member);
    }

    // Original DM logic kept for reference or direct testing
    const result = await DMService.sendGiftWithFallback(
        interaction.user,
        'Bienvenido a r/Spain',
        `Damos la bienvenida a **${username}** al Discord de r/Spain, ¡gracias por unirte!\n_We welcome **${username}** to the r/Spain Discord, thanks for joining!_`,
    );

    if (result.dmSent) {
        await interaction.editReply(`✅ Mensaje directo de bienvenida enviado.`);
    } else if (result.fallbackSent) {
        await interaction.editReply(
            `✅ Los MD estaban cerrados, así que la prueba de bienvenida se ha publicado en el canal del bot.`,
        );
    } else {
        await interaction.editReply(`❌ No se pudo enviar el MD ni el mensaje alternativo.`);
    }
}
