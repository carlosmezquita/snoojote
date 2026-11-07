import { Events, type Guild } from 'discord.js';
import type { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import verificationService from '../services/VerificationService.js';
import {
    checkpoint,
    lastObserved,
    membershipKey,
    pendingMemberships,
} from '../services/verificationJournal.js';
import { ensureSuspectLock } from '../services/suspectLock.js';

export const name = Events.ClientReady;
export const once = true;
const youngAccountMs = 90 * 86_400_000;
const boot = Date.now();

export async function reconcileGuild(guild: Guild, client: DiscordBot, since: number) {
    const failures: unknown[] = [];
    const channels = await guild.channels.fetch();
    for (const channel of channels.values()) {
        if (channel && channel.createdTimestamp >= since) {
            try {
                await ensureSuspectLock(channel);
            } catch (error) {
                failures.push(error);
            }
        }
    }
    const members = await guild.members.fetch();
    const pendingKeys = pendingMemberships();
    for (const member of members.values()) {
        const joined = member.joinedTimestamp;
        if (!joined) continue;
        const pending = pendingKeys.has(membershipKey(member));
        if (
            !pending &&
            ((joined < since && !member.roles.cache.has(config.roles.suspect)) ||
                joined - member.user.createdTimestamp > youngAccountMs)
        )
            continue;
        try {
            await verificationService.handleMemberJoin(
                member,
                client,
                joined - member.user.createdTimestamp,
            );
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length)
        throw new AggregateError(failures, 'Verification reconciliation incomplete');
}

export const execute = async (client: DiscordBot) => {
    for (const guild of client.guilds.cache.values()) {
        if (config.guildId && guild.id !== config.guildId) continue;
        // Older installations have no checkpoint yet. Adopt existing suspect-role members.
        const since = lastObserved(guild.id) ?? boot - 60_000;
        let recovered = false;
        let busy = false;
        const tick = async () => {
            if (busy || !client.isReady()) return;
            busy = true;
            try {
                if (!recovered) {
                    await reconcileGuild(guild, client, since);
                    await verificationService.cleanupStaleVerificationChannels(client);
                    recovered = true;
                }
                checkpoint(guild.id, Date.now());
            } catch (error) {
                client.logger.error('Verification recovery failed; will retry', {
                    guildId: guild.id,
                    error,
                });
            } finally {
                busy = false;
            }
        };
        await tick();
        setInterval(() => void tick(), 30_000).unref();
        setInterval(
            () =>
                void verificationService
                    .cleanupStaleVerificationChannels(client)
                    .catch((error) =>
                        client.logger.error('Verification channel cleanup failed', { error }),
                    ),
            300_000,
        ).unref();
    }
};
