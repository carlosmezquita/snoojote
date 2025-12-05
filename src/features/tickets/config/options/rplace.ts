import { ActionRowBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { TicketOptionConfig } from "../TicketConfig.js";

export const rplaceTicket: TicketOptionConfig = {
    id: "rplace",
    name: "Asistencia rPlace",
    description: "Asistencia para rPlace.\n Assistance for rPlace",
    icon: "🎨",
    label: "rPlace",
    buttonStyle: ButtonStyle.Secondary,

    adminRoles: ["1118642400357777579"],
    readOnlyRoles: [],

    channelPrefix: "rplace-",
    categoryId: "1118644187181633707",

    openMessage: "¡Has iniciado una solicitud de asistencia para rPlace en rSpain!",
    ticketWelcomeMessage: "¡Un miembro del equipo te ayudará lo antes posible!\n\n*Haz click en el botón de abajo para cerrar la solicitud.*",

    color: "Grey",

    enableDmOnOpen: true,
    autoCloseHours: 72,

    pingHere: false,
    pingEveryone: false,
    pingCustomRoleId: "1131596076097474731",

    modal: new ModalBuilder()
        .setCustomId("ticket_modal_rplace")
        .setTitle("Asistencia rPlace / Support")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId("reason")
                    .setLabel("Motivo / Reason")
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1024)
                    .setMinLength(15)
                    .setPlaceholder("Describe tu solicitud / Describe your request")
                    .setRequired(true)
            )
        )
};
