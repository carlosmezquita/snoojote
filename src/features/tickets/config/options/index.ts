import { rplaceTicket } from "./rplace.js";
import { generalTicket } from "./general.js";
import { spamTicket } from "./spam.js";
import { minecraftTicket } from "./minecraft.js";
import { TicketOptionConfig } from "../TicketConfig.js";

export const ticketOptions: Record<string, TicketOptionConfig> = {
    [generalTicket.id]: generalTicket,
    [spamTicket.id]: spamTicket,
    [rplaceTicket.id]: rplaceTicket,
    [minecraftTicket.id]: minecraftTicket
};

export const ticketOptionsList = [generalTicket, spamTicket, rplaceTicket, minecraftTicket];
