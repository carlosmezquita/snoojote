import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    type TextChannel,
    type GuildMember,
    PermissionFlagsBits,
} from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';

import { ticketOptionsList } from '../config/options/index.js';
import { mainTicketPanel } from '../config/panel.js';

import { isStaff } from '../../../shared/utils/permissions.js';

export const data = new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Send the ticket creation panel (Admin only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    if (!interaction.inGuild()) return;

    const member =
        (interaction.member as GuildMember) ||
        (await interaction.guild!.members.fetch(interaction.user.id));

    if (!isStaff(member)) {
        await interaction.reply({ content: 'No tienes permiso.', ephemeral: true });
        return;
    }

    let description = mainTicketPanel.description;

    for (const option of ticketOptionsList) {
        description += `**${option.icon} ${option.label}**\n${option.description}\n\n`;
    }

    const embed = new EmbedBuilder()
        .setTitle(mainTicketPanel.title)
        .setDescription(description)
        .setColor(mainTicketPanel.color);

    if (mainTicketPanel.footerText) {
        embed.setFooter({
            text: mainTicketPanel.footerText,
            iconURL: mainTicketPanel.footerIconUrl,
        });
    }

    if (mainTicketPanel.thumbnailUrl) {
        embed.setThumbnail(mainTicketPanel.thumbnailUrl);
    }

    if (mainTicketPanel.imageUrl) {
        embed.setImage(mainTicketPanel.imageUrl);
    }

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const buttons: ButtonBuilder[] = [];

    for (const option of ticketOptionsList) {
        const button = new ButtonBuilder()
            .setCustomId(option.id)
            .setLabel(option.label)
            .setStyle(option.buttonStyle)
            .setEmoji(option.icon);
        buttons.push(button);
    }

    // Create rows of buttons (max 5 per row)
    for (let i = 0; i < buttons.length; i += 5) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5));
        rows.push(row);
    }

    const channel = interaction.channel as TextChannel;
    if (channel) {
        await channel.send({ embeds: [embed], components: rows });
        await interaction.reply({ content: 'Panel enviado.', ephemeral: true });
    }
};
