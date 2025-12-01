import { Events, Interaction } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import verificationService from '../services/VerificationService.js';

export const name = Events.InteractionCreate;
export const once = false;

export const execute = async (interaction: Interaction, client: DiscordBot) => {
    await verificationService.handleInteraction(interaction, client);
};
