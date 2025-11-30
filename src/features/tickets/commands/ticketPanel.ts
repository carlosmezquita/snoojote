import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';

export const data = new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Send the ticket creation panel (Admin only).');

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.reply({ content: 'No tienes permiso.', ephemeral: true });
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle("Soporte / Support")
        .setDescription("Haz clic en el botón de abajo para abrir un ticket.\nClick the button below to open a ticket.")
        .setColor(0x5865F2)
        .setFooter({ text: "r/Spain Discord" });

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('Abrir Ticket / Open Ticket')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📩')
        );

    const channel = interaction.channel as TextChannel;
    if (channel) {
        await channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: "Panel enviado.", ephemeral: true });
    }
};
