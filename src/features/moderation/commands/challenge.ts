import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, GuildMember } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import verificationService from '../services/VerificationService.js';
import { createEmbed, Colors } from '../../../shared/utils/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Manually trigger verification for a user.')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to challenge')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    if (!interaction.inGuild()) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
    }

    const targetUser = interaction.options.getUser('user', true);

    let member: GuildMember | undefined;
    try {
        member = await interaction.guild?.members.fetch(targetUser.id);
    } catch (error) {
        // Handle fetch error (e.g., user not found)
    }

    if (!member) {
        await interaction.reply({ content: 'User not found in this guild.', ephemeral: true });
        return;
    }

    if (member.user.bot) {
        await interaction.reply({ content: 'Cannot challenge a bot.', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const accountAgeMs = Date.now() - member.user.createdTimestamp;

    try {
        await verificationService.handleMemberJoin(member, client, accountAgeMs);

        const embed = createEmbed(
            'Challenge Initiated',
            `Verification process started for ${member.toString()}.`,
            Colors.Success
        );
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        client.logger.error(`Error executing challenge command: ${error}`);
        await interaction.editReply({ content: 'Failed to initiate challenge.' });
    }
};
