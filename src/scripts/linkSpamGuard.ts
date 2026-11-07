import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Options } from 'discord.js';
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
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    allowedMentions: { parse: [] },
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 0 }),
});
function heartbeat() {
    if (!client.isReady()) return;
    writeFileSync('data/link-guard.ready.tmp', revision + '\n', { mode: 0o600 });
    renameSync('data/link-guard.ready.tmp', 'data/link-guard.ready');
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
client.on(Events.MessageCreate, (message) => {
    if (message.guildId !== config.guildId || !eligible(message)) return;
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
    if (!shadow) startLinkRecovery(client);
    heartbeat();
    setInterval(heartbeat, 3000).unref();
    logger.info('Link guard ready', { revision, shadow });
});
client.on('error', (error) => logger.error('Link guard gateway error', { error }));
await client.login(process.env.TOKEN);
