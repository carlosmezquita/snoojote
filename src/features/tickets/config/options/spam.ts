import {
    ButtonStyle,
    FileUploadBuilder,
    LabelBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { type TicketOptionConfig } from '../TicketConfig.js';

import { config } from '../../../../config.js';
import { screenshotLimit } from '../../services/ticketAttachments.js';

export const spamTicket: TicketOptionConfig = {
    id: 'spam',
    name: 'Reporte de Spam',
    description: 'Reportar usuarios haciendo spam o publicidad.',
    icon: '🚫',
    label: 'Spam',
    buttonStyle: ButtonStyle.Secondary,

    adminRoles: [config.roles.mod, config.roles.support],

    channelPrefix: 'spam-',
    categoryId: config.channels.ticketCategory,

    openMessage: '¡Has iniciado un reporte de Spam!',
    ticketWelcomeMessage:
        'Gracias por reportar. Un moderador revisará el caso pronto.\n\n*Haz click en el botón de abajo para cerrar la solicitud.*',

    color: 'Red',

    enableDmOnOpen: true,

    pingHere: false,
    pingEveryone: false,
    pingCustomRoleId: config.roles.ticketManager,

    modal: new ModalBuilder()
        .setCustomId('ticket_modal_spam')
        .setTitle('Reporte de Spam / Spam Report')
        .addComponents(
            new LabelBuilder()
                .setLabel('Sospechoso / Suspect')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId('reported_user')
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(100)
                        .setPlaceholder('Nombre de usuario o ID / Username or ID')
                        .setRequired(true),
                ),
            new LabelBuilder()
                .setLabel('Detalles / Details')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMaxLength(1024)
                        .setMinLength(10)
                        .setPlaceholder('Pruebas y contexto / Proof and context')
                        .setRequired(true),
                ),
            new LabelBuilder()
                .setLabel('Capturas de pantalla / Screenshots')
                .setDescription('Opcional: hasta 3 imágenes PNG, JPG, WebP o GIF; 8 MiB en total.')
                .setFileUploadComponent(
                    new FileUploadBuilder()
                        .setCustomId('screenshots')
                        .setRequired(false)
                        .setMinValues(0)
                        .setMaxValues(screenshotLimit),
                ),
        ),
};
