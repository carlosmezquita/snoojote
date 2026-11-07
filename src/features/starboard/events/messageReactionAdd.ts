import { Events } from 'discord.js';
import { queueReaction } from '../services/starboardRefresh.js';
export const name = Events.MessageReactionAdd;
export const execute = queueReaction;
