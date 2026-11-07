import { Events, type Guild } from 'discord.js';
import type { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import verificationService from '../services/VerificationService.js';
import {
    checkpoint,
    unstartedMemberships,
    forgetUnstarted,
    lastObserved,
    membershipKey,
    pendingMemberships,
} from '../services/verificationJournal.js';
import { ensureSuspectLock } from '../services/suspectLock.js';

export const name = Events.ClientReady;
export const once = true;
import { youngAccountMs } from '../services/standbyQuarantine.js';
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

export async function drainQuarantines(guild: Guild, client: DiscordBot) {
    for (const { key } of unstartedMemberships()) {
        const [guildId, userId] = JSON.parse(key) as [string, string, number];
        if (guild.id !== guildId) continue;
        try {
            const member = await guild.members.fetch({ user: userId, force: true });
            if (membershipKey(member) !== key) {
                forgetUnstarted(key);
                continue;
            }
            await verificationService.handleMemberJoin(
                member,
                client,
                member.joinedTimestamp! - member.user.createdTimestamp,
            );
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 10007)
                forgetUnstarted(key);
            else
                client.logger.error('Verification handoff failed; will retry', {
                    guildId,
                    userId,
                    error,
                });
        }
    }
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
                } else await drainQuarantines(guild, client);
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
