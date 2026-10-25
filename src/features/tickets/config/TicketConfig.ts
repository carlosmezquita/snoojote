import { type ButtonStyle, type ColorResolvable, type ModalBuilder } from 'discord.js';

export interface TicketOptionConfig {
    id: string;
    name: string;
    description: string;
    icon: string;
    label: string;
    buttonStyle: ButtonStyle;

    // Permission settings
    adminRoles: string[];

    // Channel settings
    channelPrefix: string;
    categoryId: string;

    // Messages
    openMessage: string;
    ticketWelcomeMessage: string;

    // Embed settings
    color: ColorResolvable;
    thumbnailUrl?: string;
    imageUrl?: string;

    // Features
    enableDmOnOpen: boolean;

    // Pings
    pingHere: boolean;
    pingEveryone: boolean;
    pingCustomRoleId?: string;

    // Modal
    modal?: ModalBuilder;
}

export interface TicketPanelConfig {
    title: string;
    description: string;
    color: ColorResolvable;
    thumbnailUrl?: string;
    imageUrl?: string;
    footerText?: string;
    footerIconUrl?: string;
}
