import { rplaceTicket } from './rplace.js';
import { generalTicket } from './general.js';
import { spamTicket } from './spam.js';
import { type TicketOptionConfig } from '../TicketConfig.js';

export const ticketOptions: Record<string, TicketOptionConfig> = {
    [generalTicket.id]: generalTicket,
    [spamTicket.id]: spamTicket,
    [rplaceTicket.id]: rplaceTicket,
};

export const ticketOptionsList = [generalTicket, spamTicket, rplaceTicket];
