import { ChatInputCommandInteraction, GuildMember, PermissionFlagsBits, SlashCommandBuilder, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import ticketService from '../services/ticketService.js';

export const data = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Gestiona el ticket actual.')
    .addSubcommand(subcommand =>
        subcommand
            .setName('claim')
            .setDescription('Reclama el ticket actual.'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('unclaim')
            .setDescription('Libera el ticket actual.'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('close')
            .setDescription('Cierra el ticket actual.')
            .addStringOption(option =>
                option
                    .setName('reason')
                    .setDescription('Motivo de cierre')
                    .setMaxLength(1024)
                    .setRequired(false)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('reopen')
            .setDescription('Reabre el ticket actual.'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('delete')
            .setDescription('Elimina el canal del ticket actual.'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Añade un usuario al ticket actual.')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('Usuario a añadir')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('remove')
            .setDescription('Retira un usuario del ticket actual.')
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('Usuario a retirar')
                    .setRequired(true)));

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    if (!interaction.inGuild() || !interaction.channel || !interaction.channel.isTextBased()) {
        await interaction.reply({ content: 'Este comando solo puede usarse dentro de un ticket.', ephemeral: true });
        return;
    }

    const channel = interaction.channel as TextChannel;
    const ticket = await ticketService.getTicketByChannel(channel.id);
    if (!ticket) {
        await interaction.reply({ content: 'Este canal no es un ticket activo.', ephemeral: true });
        return;
    }

    const member = await getGuildMember(interaction);
    if (!member) {
        await interaction.reply({ content: 'No pude verificar tus permisos.', ephemeral: true });
        return;
    }

    const subcommand = interaction.options.getSubcommand();
    const isManager = canManageTickets(member);
    const isOwner = ticket.userId === interaction.user.id;

    if (subcommand === 'close' && !isManager && !isOwner) {
        await interaction.reply({ content: 'No tienes permiso para cerrar este ticket.', ephemeral: true });
        return;
    }

    if (subcommand !== 'close' && !isManager) {
        await interaction.reply({ content: 'No tienes permiso para gestionar este ticket.', ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        if (subcommand === 'claim') {
            const result = await ticketService.claimTicket(channel, interaction.user);
            await interaction.editReply(result.message);
            return;
        }

        if (subcommand === 'unclaim') {
            const result = await ticketService.unclaimTicket(channel, interaction.user);
            await interaction.editReply(result.message);
            return;
        }

        if (subcommand === 'close') {
            const reason = interaction.options.getString('reason') || 'No reason provided.';
            await ticketService.closeTicket(channel, interaction.user, reason);
            await interaction.editReply('Ticket cerrado.');
            return;
        }

        if (subcommand === 'reopen') {
            await ticketService.reopenTicket(channel, interaction.user);
            await interaction.editReply('Ticket reabierto.');
            return;
        }

        if (subcommand === 'delete') {
            await ticketService.deleteTicket(channel, interaction.user);
            await interaction.editReply('Ticket marcado para eliminación.');
            return;
        }

        const target = interaction.options.getUser('user', true);

        if (subcommand === 'add') {
            await ticketService.addUser(channel, target, interaction.user);
            await interaction.editReply(`${target.toString()} añadido al ticket.`);
            return;
        }

        if (subcommand === 'remove') {
            await ticketService.removeUser(channel, target, interaction.user);
            await interaction.editReply(`${target.toString()} retirado del ticket.`);
        }
    } catch (error) {
        client.logger.error(`Ticket command error: ${error}`);
        await interaction.editReply('No se pudo completar la acción del ticket.');
    }
};

async function getGuildMember(interaction: ChatInputCommandInteraction): Promise<GuildMember | null> {
    if (interaction.member instanceof GuildMember) return interaction.member;
    return await interaction.guild?.members.fetch(interaction.user.id).catch(() => null) ?? null;
}

function canManageTickets(member: GuildMember): boolean {
    return member.permissions.has(PermissionFlagsBits.Administrator)
        || member.roles.cache.has(config.roles.mod)
        || member.roles.cache.has(config.roles.support);
}
