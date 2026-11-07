import { Events } from 'discord.js';
import { queueReaction } from '../services/starboardRefresh.js';
export const name = Events.MessageReactionRemove;
export const execute = queueReaction;
