import { DiscordBot } from '../core/client.js';
import installCommands from '../core/handlers/commandHandler.js';
import { initializeDispatch, reportDispatchError } from '../core/restartDispatch.js';
import { listenForReactions } from '../features/starboard/services/starboardRefresh.js';
import ai from '../features/ai/events/messageCreate.js';
import { observeJoin } from '../features/moderation/events/memberJoinTrap.js';
import { execute as inviteCreate } from '../features/moderation/events/inviteCreate.js';
import { execute as inviteDelete } from '../features/moderation/events/inviteDelete.js';
import { execute as welcome } from '../features/welcome/events/guildMemberAdd.js';
import { execute as requesterJoin } from '../features/tickets/events/requesterJoin.js';
import { execute as requesterLeave } from '../features/tickets/events/requesterLeave.js';
import 'dotenv/config';
import voiceUpdates from '../features/economy/events/voiceStateUpdate.js';
import { execute as startVoice } from '../features/economy/events/voiceReady.js';
import { quarantineJoin } from '../features/moderation/services/standbyQuarantine.js';
import { ensureSuspectLock } from '../features/moderation/services/suspectLock.js';
import ticketReplies from '../features/tickets/events/messageCreate.js';
import rewards from '../features/economy/events/messageCreate.js';
import { Events } from 'discord.js';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { config } from '../config.js';
import { assertBotConfigReady } from '../configLoader.js';
import { sqlite } from '../database/db.js';
import { eligible, execute } from '../features/moderation/events/linkSpam.js';
import { startLinkRecovery } from '../features/moderation/services/linkRecovery.js';
import logger from '../utils/logger.js';

assertBotConfigReady();
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const shadow = process.env.LINK_GUARD_MODE === 'shadow';
const started = Date.now();
const windows = new Map<string, { start: number; count: number }>();
const seen = new Map<string, number>();
const client = new DiscordBot();
if (!shadow) {
    initializeDispatch('standby');
    await installCommands(client);
    listenForReactions(client);
    client.on(
        'guildMemberVerified',
        (member) => void welcome(member, client).catch(reportDispatchError),
    );
    client.on(Events.InviteCreate, (invite) => {
        if (invite.guild?.id === config.guildId)
            void inviteCreate(invite, client).catch(reportDispatchError);
    });
    client.on(Events.InviteDelete, (invite) => {
        if (invite.guild?.id === config.guildId)
            void inviteDelete(invite, client).catch(reportDispatchError);
    });
}
function heartbeat() {
    if (!client.isReady() || !config.guildId || !client.guilds.cache.get(config.guildId)?.available)
        return;
    if (!shadow) {
        writeFileSync('data/link-guard.ready.tmp', revision + '\n', { mode: 0o600 });
        renameSync('data/link-guard.ready.tmp', 'data/link-guard.ready');
    }
    for (const [key, value] of windows) if (Date.now() - value.start > 60_000) windows.delete(key);
    for (const [id, time] of seen) if (Date.now() - time > 60_000) seen.delete(id);
    // The deployer publishes the revision only after primary login and registration.
    // On cold boot HEAD may already be newer than the marker during a cutover.
    let desired: string;
    try {
        desired = readFileSync('.git/snoojote-link-guard-ref', 'utf8').trim();
    } catch {
        return;
    }
    if (
        desired !== revision &&
        desired === execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    )
        process.exit(0);
}
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (shadow || newState.guild.id !== config.guildId) return;
    void voiceUpdates
        .execute(oldState, newState)
        .catch((error) => logger.error('Standby voice transition failed', { error }));
});
client.on(Events.GuildMemberRemove, (member) => {
    if (shadow || member.guild.id !== config.guildId) return;
    void requesterLeave(member).catch((error) =>
        logger.error('Standby requester leave failed', { error }),
    );
});
client.on(Events.GuildMemberAdd, (member) => {
    if (shadow || member.guild.id !== config.guildId) return;
    try {
        requesterJoin(member);
    } catch (error) {
        logger.error('Standby requester join failed', { error });
    }
    void observeJoin(member, client).catch(reportDispatchError);
    void quarantineJoin(member).catch((error) =>
        logger.error('Standby join quarantine failed', { userId: member.id, error }),
    );
});
client.on(Events.ChannelCreate, (channel) => {
    if (shadow || channel.guild.id !== config.guildId) return;
    void ensureSuspectLock(channel).catch((error) =>
        logger.error('Standby suspect lock failed', { channelId: channel.id, error }),
    );
});
client.on(Events.MessageCreate, (message) => {
    if (message.guildId !== config.guildId) return;
    if (!shadow) void ai.execute(message, client).catch(reportDispatchError);
    if (!shadow)
        void ticketReplies
            .execute(message)
            .catch((error) =>
                logger.error('Standby ticket reply failed', { messageId: message.id, error }),
            );
    if (!shadow)
        void rewards
            .execute(message)
            .catch((error) =>
                logger.error('Standby message rewards failed', { messageId: message.id, error }),
            );
    if (!eligible(message)) return;
    if (shadow) {
        if (seen.has(message.id)) return;
        seen.set(message.id, message.createdTimestamp);
        const key = message.author.id;
        const prior = windows.get(key);
        const window =
            prior && message.createdTimestamp - prior.start <= 60_000
                ? prior
                : { start: message.createdTimestamp, count: 0 };
        const expected = ++window.count;
        windows.set(key, window);
        if (Date.now() - started > 60_000)
            setTimeout(() => {
                const row = sqlite
                    .query<{ count: number }, [string]>(
                        'SELECT count FROM link_spam_events WHERE message_id=?',
                    )
                    .get(message.id);
                logger.info('Link guard shadow comparison', {
                    messageId: message.id,
                    match: row?.count === expected,
                });
            }, 2000).unref();
        return;
    }
    // Give the primary the first opportunity. Either receiver can finish the
    // decision. Persist before waiting so a crash cannot lose the dispatch.
    void execute(message, client, 750).catch((error) =>
        logger.error('Link guard delivery failed', { messageId: message.id, error }),
    );
});
client.once(Events.ClientReady, () => {
    if (!shadow) {
        startVoice(client);
        startLinkRecovery(client);
    }
    heartbeat();
    setInterval(heartbeat, 3000).unref();
    logger.info('Link guard ready', { revision, shadow });
});
client.on('error', (error) => logger.error('Link guard gateway error', { error }));
await client.login(process.env.TOKEN);
