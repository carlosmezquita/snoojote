import {
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { type TicketOptionConfig } from '../TicketConfig.js';

import { config } from '../../../../config.js';

export const minecraftTicket: TicketOptionConfig = {
    id: 'minecraft',
    name: 'Asistencia Minecraft',
    description: 'Ayuda con el servidor de Minecraft.',
    icon: '⛏️',
    label: 'Minecraft',
    buttonStyle: ButtonStyle.Secondary,

    adminRoles: [config.roles.support, config.roles.mod],
    readOnlyRoles: [],

    channelPrefix: 'mc-',
    categoryId: config.channels.ticketCategory,

    openMessage: '¡Has iniciado una solicitud de asistencia para Minecraft!',
    ticketWelcomeMessage:
        '¡Un miembro del equipo te ayudará lo antes posible!\n\n*Haz click en el botón de abajo para cerrar la solicitud.*',

    color: 'Green',

    enableDmOnOpen: true,
    autoCloseHours: 48,

    pingHere: false,
    pingEveryone: false,
    pingCustomRoleId: config.roles.ticketManager,

    modal: new ModalBuilder()
        .setCustomId('ticket_modal_minecraft')
        .setTitle('Asistencia Minecraft / Support')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('mc_username')
                    .setLabel('Usuario Minecraft / Minecraft User')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(16)
                    .setPlaceholder('Nick en el juego / In-game nick')
                    .setRequired(true),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Motivo / Reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1024)
                    .setMinLength(10)
                    .setPlaceholder('¿Por qué quieres unirte? / Why do you want to join?')
                    .setRequired(true),
            ),
        ),
};
