import { Events } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import verificationService from '../services/VerificationService.js';

let staleCleanupStarted = false;

export const name = Events.ClientReady;
export const once = true;

export const execute = async (client: DiscordBot) => {
    if (staleCleanupStarted) return;
    staleCleanupStarted = true;

    await verificationService.cleanupStaleVerificationChannels(client);

    const interval = setInterval(() => {
        void verificationService.cleanupStaleVerificationChannels(client);
    }, 5 * 60 * 1000);

    interval.unref?.();
    client.logger.info('Verification stale channel cleanup scheduled every 5 minutes.');
};
