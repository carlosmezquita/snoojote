import { Events, type MessageReaction, type User } from 'discord.js';
import { StarboardService } from '../services/StarboardService.js';

export const name = Events.MessageReactionAdd;

export const execute = async (reaction: MessageReaction, user: User) => {
    if (user.bot) return;
    await StarboardService.handleReactionUpdate(reaction.message as any);
};
