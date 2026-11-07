import { Events } from 'discord.js';
import { queueMessage } from '../services/starboardRefresh.js';
export const name = Events.MessageReactionRemoveAll;
export const execute = queueMessage;
