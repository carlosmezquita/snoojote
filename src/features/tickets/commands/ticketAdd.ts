import { ChatInputCommandInteraction, TextChannel, PermissionFlagsBits } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import ticketMemberService from '../services/ticketMemberService.js';
import { createSuccessEmbed, createErrorEmbed } from '../../../shared/utils/embeds.js';

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    // Check if channel is a valid ticket
    const channelId = interaction.channelId;
    if (!channelId) return;

    const ticket = await ticketMemberService.getTicket(channelId);

    if (!ticket) {
        await interaction.reply({
            embeds: [createErrorEmbed('Error', 'This command can only be used in an open ticket channel.')],
            ephemeral: true
        });
        return;
    }

    // Check permissions: Staff (ManageChannels) or Ticket Owner
    const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
    const isOwner = ticket.userId === interaction.user.id;

    if (!isStaff && !isOwner) {
        await interaction.reply({
            embeds: [createErrorEmbed('Error', 'You do not have permission to manage members in this ticket.')],
            ephemeral: true
        });
        return;
    }

    const user = interaction.options.getUser('user');

    if (!user) {
        await interaction.reply({
            embeds: [createErrorEmbed('Error', 'Please provide a valid user.')],
            ephemeral: true
        });
        return;
    }

    const channel = interaction.channel as TextChannel;

    try {
        await ticketMemberService.addMember(channel, user);
        await interaction.reply({
            embeds: [createSuccessEmbed('User Added', `Successfully added ${user.toString()} to the ticket.`)]
        });
    } catch (error) {
        console.error('Error adding user to ticket:', error);
        await interaction.reply({
            embeds: [createErrorEmbed('Error', 'Failed to add user to the ticket.')],
            ephemeral: true
        });
    }
};
