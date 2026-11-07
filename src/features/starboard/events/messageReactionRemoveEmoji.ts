import { Events } from 'discord.js';
import { queueRemovedEmoji } from '../services/starboardRefresh.js';
export const name = Events.MessageReactionRemoveEmoji;
export const execute = queueRemovedEmoji;
