import {
    type ChatInputCommandInteraction,
    GuildMember,
    PermissionFlagsBits,
    SlashCommandBuilder,
    type TextChannel,
} from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import ticketService from '../services/ticketService.js';
import responseTimeService from '../services/responseTimeService.js';
import { createWaitEstimateReport } from '../utils/waitEstimateReport.js';
import { isTicketStaff } from '../utils/ticketStaff.js';

export const data = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Gestiona el ticket actual.')
    .addSubcommand((subcommand) =>
        subcommand.setName('claim').setDescription('Reclama el ticket actual.'),
    )
    .addSubcommand((subcommand) =>
        subcommand.setName('unclaim').setDescription('Libera el ticket actual.'),
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName('close')
            .setDescription('Cierra el ticket actual.')
            .addStringOption((option) =>
                option
                    .setName('reason')
                    .setDescription('Motivo de cierre')
                    .setMaxLength(1024)
                    .setRequired(false),
            ),
    )
    .addSubcommand((subcommand) =>
        subcommand.setName('reopen').setDescription('Reabre el ticket actual.'),
    )
    .addSubcommand((subcommand) =>
        subcommand.setName('delete').setDescription('Elimina el canal del ticket actual.'),
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName('wait')
            .setDescription('Consulta la primera respuesta estimada para un ticket nuevo (admin).')
            .addBooleanOption((option) =>
                option
                    .setName('details')
                    .setDescription('Incluye presencias y factores del estimador.')
                    .setRequired(false),
            ),
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName('add')
            .setDescription('Añade un usuario al ticket actual.')
            .addUserOption((option) =>
                option.setName('user').setDescription('Usuario a añadir').setRequired(true),
            ),
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName('remove')
            .setDescription('Retira un usuario del ticket actual.')
            .addUserOption((option) =>
                option.setName('user').setDescription('Usuario a retirar').setRequired(true),
            ),
    );

export const execute = async (interaction: ChatInputCommandInteraction, client: DiscordBot) => {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: 'Este comando solo puede usarse dentro del servidor.',
            ephemeral: true,
        });
        return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'wait' || subcommand === 'waitdebug') {
        // The interaction carries Discord's current permission snapshot; fail closed if absent.
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({
                content: 'Solo administradores pueden consultar datos internos del estimador.',
                ephemeral: true,
            });
            return;
        }
        // Redirect commands still registered during a rolling deployment, without a second report.
        if (subcommand === 'waitdebug') {
            await interaction.reply({
                content: 'Este diagnóstico ahora está en `/ticket wait` (opción `details`).',
                ephemeral: true,
            });
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        try {
            const status = await responseTimeService.getWaitEstimateStatus(interaction.guild!, {
                forceRefresh: true,
            });
            await interaction.editReply({
                embeds: createWaitEstimateReport(
                    status,
                    interaction.options.getBoolean('details') ?? false,
                ),
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            client.logger.error('Ticket wait command failed', {
                guildId: interaction.guildId,
                error,
            });
            await interaction.editReply('No se pudo consultar el estimador.');
        }
        return;
    }

    const member = await getGuildMember(interaction);
    if (!member) {
        await interaction.reply({ content: 'No pude verificar tus permisos.', ephemeral: true });
        return;
    }
    const isManager = isTicketStaff(member);

    if (!interaction.channel || !interaction.channel.isTextBased()) {
        await interaction.reply({
            content: 'Este comando solo puede usarse dentro de un ticket.',
            ephemeral: true,
        });
        return;
    }

    const channel = interaction.channel as TextChannel;
    const ticket = await ticketService.getTicketByChannel(channel.id);
    if (!ticket) {
        await interaction.reply({ content: 'Este canal no es un ticket activo.', ephemeral: true });
        return;
    }

    const isOwner = ticket.userId === interaction.user.id;

    if (subcommand === 'close' && !isManager && !isOwner) {
        await interaction.reply({
            content: 'No tienes permiso para cerrar este ticket.',
            ephemeral: true,
        });
        return;
    }

    if (subcommand !== 'close' && !isManager) {
        await interaction.reply({
            content: 'No tienes permiso para gestionar este ticket.',
            ephemeral: true,
        });
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

async function getGuildMember(
    interaction: ChatInputCommandInteraction,
): Promise<GuildMember | null> {
    if (interaction.member instanceof GuildMember) return interaction.member;
    return (await interaction.guild?.members.fetch(interaction.user.id).catch(() => null)) ?? null;
}
