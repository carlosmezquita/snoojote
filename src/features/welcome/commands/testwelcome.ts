import { SlashCommandBuilder, type ChatInputCommandInteraction, GuildMember, PermissionFlagsBits } from 'discord.js';
import { DMService } from '../../../shared/services/DMService.js';
import { isStaff } from '../../../shared/utils/permissions.js';

export const data = new SlashCommandBuilder()
    .setName('testwelcome')
    .setDescription('Test the Welcome DM')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inGuild()) return;

    const member = (interaction.member as GuildMember) || 
        await interaction.guild!.members.fetch(interaction.user.id);

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
    const sent = await DMService.sendGift(
        interaction.user,
        'Welcome to r/Spain!',
        `Damos la bienvenida a **${username}** al Discord de r/Spain, ¡gracias por unirte!\n_We welcome **${username}** to the r/Spain Discord, thanks for joining!_`,
    );

    if (sent) {
        await interaction.editReply(`✅ Welcome DM sent!`);
    } else {
        await interaction.editReply(`❌ Failed to send DM.`);
    }
}
