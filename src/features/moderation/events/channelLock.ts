import { Events } from 'discord.js';
import { ensureSuspectLock } from '../services/suspectLock.js';

export const name = Events.ChannelCreate;
export const once = false;
export const execute = ensureSuspectLock;
