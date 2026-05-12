import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    PermissionFlagsBits,
    type GuildMember,
} from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import verificationService from '../services/VerificationService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';

import { isStaff } from '../../../shared/utils/permissions.js';

export const data = new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Manually trigger verification for a user.')
    .addUserOption((option) =>
        option.setName('user').setDescription('The user to challenge').setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: 'This command can only be used in a server.',
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

    const targetUser = interaction.options.getUser('user', true);

    let targetMember: GuildMember | undefined;
    try {
        targetMember = await interaction.guild?.members.fetch(targetUser.id);
    } catch (error) {
        // Handle fetch error (e.g., user not found)
    }

    if (!targetMember) {
        await interaction.reply({ content: 'User not found in this guild.', ephemeral: true });
        return;
    }

    if (targetMember.user.bot) {
        await interaction.reply({ content: 'Cannot challenge a bot.', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const accountAgeMs = Date.now() - targetMember.user.createdTimestamp;

    try {
        await verificationService.handleMemberJoin(targetMember, client, accountAgeMs);

        const embed = createEmbed(
            'Challenge Initiated',
            `Verification process started for ${targetMember.toString()}.`,
            Colors.Success,
        );
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        client.logger.error(`Error executing challenge command: ${error}`);
        await interaction.editReply({ content: 'Failed to initiate challenge.' });
    }
};
