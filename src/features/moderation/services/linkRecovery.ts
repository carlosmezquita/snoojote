import type { Client } from 'discord.js';
import { sqlite } from '../../../database/db.js';
import logger from '../../../utils/logger.js';
import { actionsFor } from '../events/linkSpam.js';
import { enforceLink, retentionMs, type LinkEvent } from './linkSpamJournal.js';

export function startLinkRecovery(client: Client) {
    let busy = false;
    const run = async () => {
        if (busy || !client.isReady()) return;
        busy = true;
        try {
            const now = Date.now();
            sqlite.run('DELETE FROM link_spam_events WHERE done=1 AND observed_at<?', [
                now - retentionMs,
            ]);
            const rows = sqlite
                .query<LinkEvent & { count: number; claimed: number }, [number]>(
                    'SELECT message_id as messageId,guild_id as guildId,user_id as userId,channel_id as channelId,observed_at as observedAt,count,claimed FROM link_spam_events WHERE done=0 AND observed_at<? ORDER BY observed_at LIMIT 100',
                )
                .all(now - 60_000);
            for (const row of rows) {
                try {
                    if (now - row.observedAt > 300_000 && row.count === 4 && !(row.claimed & 2)) {
                        sqlite.run(
                            'UPDATE link_spam_events SET done=2 WHERE message_id=? AND done=0',
                            [row.messageId],
                        );
                        logger.warn('Stale unissued link ban requires moderator review', {
                            messageId: row.messageId,
                        });
                        continue;
                    }
                    await enforceLink(
                        row.messageId,
                        row.count,
                        actionsFor(client, row, row.count),
                        true,
                    );
                } catch (error) {
                    logger.error('Link moderation recovery failed', {
                        messageId: row.messageId,
                        error,
                    });
                }
            }
        } finally {
            busy = false;
        }
    };
    const tick = () =>
        void run().catch((error) => logger.error('Link moderation journal unavailable', { error }));
    tick();
    setInterval(tick, 30_000).unref();
}
