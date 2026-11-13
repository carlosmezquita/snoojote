import { Events } from 'discord.js';
import { startStarboardRefresh } from '../services/starboardRefresh.js';
export const name = Events.ClientReady;
export const once = true;
export const execute = startStarboardRefresh;
