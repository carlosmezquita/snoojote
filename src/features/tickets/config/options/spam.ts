import {
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { type TicketOptionConfig } from '../TicketConfig.js';

import { config } from '../../../../config.js';

export const spamTicket: TicketOptionConfig = {
    id: 'spam',
    name: 'Reporte de Spam',
    description: 'Reportar usuarios haciendo spam o publicidad.',
    icon: '🚫',
    label: 'Spam',
    buttonStyle: ButtonStyle.Secondary,

    adminRoles: [config.roles.mod, config.roles.support],
    readOnlyRoles: [],

    channelPrefix: 'spam-',
    categoryId: config.channels.ticketCategory,

    openMessage: '¡Has iniciado un reporte de Spam!',
    ticketWelcomeMessage:
        'Gracias por reportar. Un moderador revisará el caso pronto.\n\n*Haz click en el botón de abajo para cerrar la solicitud.*',

    color: 'Red',

    enableDmOnOpen: true,
    autoCloseHours: 24,

    pingHere: false,
    pingEveryone: false,
    pingCustomRoleId: config.roles.ticketManager,

    modal: new ModalBuilder()
        .setCustomId('ticket_modal_spam')
        .setTitle('Reporte de Spam / Spam Report')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('reported_user')
                    .setLabel('Usuario / User')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setPlaceholder('Nombre de usuario o ID / Username or ID')
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Detalles / Details')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1024)
                    .setMinLength(10)
                    .setPlaceholder('Pruebas y contexto / Proof and context')
                    .setRequired(true),
            ),
        ),
};
