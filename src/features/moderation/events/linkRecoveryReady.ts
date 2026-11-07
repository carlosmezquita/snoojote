import { Events } from 'discord.js';
import { startLinkRecovery } from '../services/linkRecovery.js';
export const name = Events.ClientReady;
export const once = true;
export const execute = startLinkRecovery;
