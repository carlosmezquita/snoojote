import type { Database } from 'bun:sqlite';
import { sqlite as applicationDb } from '../../../database/db.js';

export interface LinkEvent {
    messageId: string;
    guildId: string;
    userId: string;
    channelId: string;
    observedAt: number;
}
export const retentionMs = 7 * 86_400_000;
export const effect = { remove: 1, ban: 2, dm: 4, alert: 8, banLog: 16 } as const;

export function getLinkRateLimitDecision(count: number) {
    const violationCount = Math.max(count - 1, 0);
    return { shouldDelete: violationCount > 0, shouldBan: violationCount >= 3, violationCount };
}

export interface SpamActions {
    remove(): Promise<void>;
    ban(): Promise<void>;
    isBanned(): Promise<boolean>;
    dm(): Promise<void>;
    alert(): Promise<void>;
    banLog(): Promise<void>;
    failed(action: string, error: unknown): void;
}

export function createLinkJournal(sqlite: Database) {
    // Both Gateway sessions may receive the dispatch. BEGIN IMMEDIATE serializes the
    // message-ID check with the window update across independent SQLite connections.
    function recordLink(input: LinkEvent, now = Date.now()) {
        if (input.observedAt < now - retentionMs) return null;
        return sqlite
            .transaction(() => {
                const existing = sqlite
                    .query<{ count: number }, [string]>(
                        'SELECT count FROM link_spam_events WHERE message_id=?',
                    )
                    .get(input.messageId);
                if (existing) return existing.count;
                const prior = sqlite
                    .query<{ window_start: number; count: number }, [string, string]>(
                        'SELECT window_start,count FROM link_spam_events WHERE guild_id=? AND user_id=? ORDER BY window_start DESC,count DESC LIMIT 1',
                    )
                    .get(input.guildId, input.userId);
                const same = prior && input.observedAt - prior.window_start <= 60_000;
                const count = same ? prior.count + 1 : 1;
                const policy = getLinkRateLimitDecision(count);
                const required = policy.shouldDelete
                    ? effect.remove |
                      effect.alert |
                      (count === 4
                          ? effect.ban | effect.dm | effect.banLog
                          : !policy.shouldBan
                            ? effect.dm
                            : 0)
                    : 0;
                sqlite.run(
                    'INSERT INTO link_spam_events(message_id,guild_id,user_id,channel_id,observed_at,window_start,count,required,done) VALUES(?,?,?,?,?,?,?,?,?)',
                    [
                        input.messageId,
                        input.guildId,
                        input.userId,
                        input.channelId,
                        input.observedAt,
                        same ? prior.window_start : input.observedAt,
                        count,
                        required,
                        required ? 0 : 1,
                    ],
                );
                return count;
            })
            .immediate();
    }

    async function enforceLink(id: string, count: number, actions: SpamActions, recovery = false) {
        if (count <= 1) return;
        // The fourth eligible message owns the sanction for this member/window.
        const record = sqlite
            .query<{ required: number; done: number }, [string]>(
                'SELECT required,done FROM link_spam_events WHERE message_id=?',
            )
            .get(id);
        if (!record || record.done) return;
        const required = record.required;
        const sanction = !!(required & effect.ban);
        async function attempt(bit: number, name: keyof Omit<SpamActions, 'failed'>) {
            const claim = sqlite.run(
                'UPDATE link_spam_events SET claimed=claimed|? WHERE message_id=? AND done=0 AND (claimed & ?)=0',
                [bit, id, bit],
            );
            if (!claim.changes) return;
            try {
                await actions[name]();
                sqlite.run('UPDATE link_spam_events SET finished=finished|? WHERE message_id=?', [
                    bit,
                    id,
                ]);
            } catch (error) {
                actions.failed(name, error);
            }
        }
        await attempt(effect.remove, 'remove');
        if (required & effect.dm) await attempt(effect.dm, 'dm');
        if (sanction) {
            await attempt(effect.ban, 'ban');
            const row = sqlite
                .query<{ finished: number }, [string]>(
                    'SELECT finished FROM link_spam_events WHERE message_id=?',
                )
                .get(id);
            if (row && row.finished & effect.ban) await attempt(effect.banLog, 'banLog');
        }
        await attempt(effect.alert, 'alert');
        if (recovery) {
            const row = sqlite
                .query<{ claimed: number; finished: number; done: number }, [string]>(
                    'SELECT claimed,finished,done FROM link_spam_events WHERE message_id=?',
                )
                .get(id);
            if (!row || row.done) return;
            // A missing message can be deleted idempotently. A missing ban after an
            // ambiguous request may be an intentional unban: never issue it again.
            if (!(row.finished & effect.remove)) {
                await actions.remove();
                sqlite.run('UPDATE link_spam_events SET finished=finished|? WHERE message_id=?', [
                    effect.remove,
                    id,
                ]);
            }
            if (sanction && !(row.finished & effect.ban)) {
                if (!(await actions.isBanned())) {
                    sqlite.run('UPDATE link_spam_events SET done=2 WHERE message_id=? AND done=0', [
                        id,
                    ]);
                    actions.failed('ambiguous ban; moderator review required', id);
                    return;
                }
                sqlite.run('UPDATE link_spam_events SET finished=finished|? WHERE message_id=?', [
                    effect.ban,
                    id,
                ]);
                await attempt(effect.banLog, 'banLog');
            }
        }
        // Notifications are at-most-once; an ambiguous send is never replayed.
        sqlite.run(
            'UPDATE link_spam_events SET done=1 WHERE message_id=? AND (claimed & ?)=? AND (finished & ?)=? AND done=0',
            [id, required, required, sanction ? 3 : 1, sanction ? 3 : 1],
        );
    }

    return { recordLink, enforceLink };
}
export const { recordLink, enforceLink } = createLinkJournal(applicationDb);
