import { ActionRowBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { TicketOptionConfig } from "../TicketConfig.js";

export const generalTicket: TicketOptionConfig = {
    id: "general",
    name: "Asistencia General",
    description: "Dudas generales, problemas con el servidor, etc.",
    icon: "❓",
    label: "General",
    buttonStyle: ButtonStyle.Secondary,

    adminRoles: ["1118642400357777579"], // Adjust roles as needed
    readOnlyRoles: [],

    channelPrefix: "general-",
    categoryId: "1118644187181633707", // Adjust category ID as needed

    openMessage: "¡Has iniciado una solicitud de asistencia General!",
    ticketWelcomeMessage: "¡Un miembro del equipo te ayudará lo antes posible!\n\n*Haz click en el botón de abajo para cerrar la solicitud.*",

    color: "Blue",

    enableDmOnOpen: true,
    autoCloseHours: 48,

    pingHere: false,
    pingEveryone: false,
    pingCustomRoleId: "1131596076097474731", // Adjust role ID as needed

    modal: new ModalBuilder()
        .setCustomId("ticket_modal_general")
        .setTitle("Asistencia General / General Support")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId("reason")
                    .setLabel("Motivo / Reason")
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1024)
                    .setMinLength(10)
                    .setPlaceholder("Describe tu problema / Describe your issue")
                    .setRequired(true)
            )
        )
};
