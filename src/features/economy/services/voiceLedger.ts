import type { Client, Guild, VoiceState } from 'discord.js';
import { and, eq, isNotNull, inArray, or } from 'drizzle-orm';
import db from '../../../database/db.js';
import { voiceSessions } from '../../../database/schema.js';
import { config } from '../../../config.js';
import economy from './economyService.js';
import quests, { QuestType } from './questService.js';
import { datedMinutes } from './voiceSessionService.js';
import { getSpainDateKey } from '../../streaks/services/streakRules.js';
import { DMService } from '../../../shared/services/DMService.js';
import logger from '../../../utils/logger.js';

type Row = typeof voiceSessions.$inferSelect;
export type Position = Pick<Row, 'channelId' | 'sessionId'>;
const maxObservationGap = 45_000;
const absent: Position = { channelId: null, sessionId: null };
const same = (a: Position, b: Position) =>
    a.channelId === b.channelId && a.sessionId === b.sessionId;
export function position(state: VoiceState): Position {
    return state.channelId ? { channelId: state.channelId, sessionId: state.sessionId } : absent;
}
const memberWhere = (guild: string, user: string) =>
    and(eq(voiceSessions.guildId, guild), eq(voiceSessions.userId, user));

function settle(row: Row, until: number, client: Client, now: number) {
    let cursor = row.cursor,
        completion: string | undefined;
    if (row.channelId && !quests.isExcludedQuestChannel(row.channelId)) {
        const { slices, lastCompletion } = datedMinutes(row.channelId, cursor, until);
        cursor = lastCompletion;
        for (const { earnedAt, minutes } of slices) {
            economy.addCappedEarningSync(
                row.userId,
                'VOICE',
                Math.floor(minutes * config.economy.voiceRewards.perMinute),
                config.economy.voiceRewards.dailyCap,
                earnedAt,
            );
            if (getSpainDateKey(earnedAt) !== getSpainDateKey(new Date(now))) continue;
            const quest = economy.getDailyQuestSync(row.userId, client, new Date(now));
            if (quest.type !== QuestType.VOICE_TIME || quest.isCompleted) continue;
            const updated = economy.updateQuestProgressSync(
                row.userId,
                QuestType.VOICE_TIME,
                minutes,
                undefined,
                new Date(now),
            );
            if (updated?.isCompleted) completion = updated.description;
        }
    }
    return { cursor, completion };
}

// Each ordered Gateway stream tracks its own progress. A late copy of A→B
// must not repeat the move after the faster stream has already returned to A.
export class VoiceObserver {
    private readonly revisions = new Map<string, number>();
    observe(
        guild: string,
        user: string,
        from: Position | null,
        to: Position,
        client: Client,
        now = Date.now(),
        snapshotRevision?: number,
    ) {
        const key = guild + ':' + user;
        const expected = this.revisions.get(key) ?? 0;
        const result = db.transaction(
            (tx) => {
                const where = memberWhere(guild, user);
                const row = tx.select().from(voiceSessions).where(where).get();
                const revision = row?.revision ?? 0;
                if (snapshotRevision !== undefined && snapshotRevision !== revision)
                    return { revision: expected };
                if (from && expected < revision) return { revision: expected + 1 };
                if (row && same(row, to)) {
                    // A startup snapshot confirms only the current position. If both
                    // listeners were absent, preserve known minutes and omit the gap.
                    const gap = !from && now - row.confirmedAt > maxObservationGap && row.channelId;
                    const reward = gap ? settle(row, row.confirmedAt, client, now) : undefined;
                    tx.update(voiceSessions)
                        .set({ confirmedAt: now, cursor: gap ? now : row.cursor })
                        .where(where)
                        .run();
                    return { revision, completion: reward?.completion };
                }
                if (from && row && !same(row, from)) return { revision };
                const reward = row
                    ? settle(
                          row,
                          from && now - row.confirmedAt <= maxObservationGap
                              ? now
                              : row.confirmedAt,
                          client,
                          now,
                      )
                    : undefined;
                const next = { ...to, cursor: now, confirmedAt: now, revision: revision + 1 };
                tx.insert(voiceSessions)
                    .values({ guildId: guild, userId: user, ...next })
                    .onConflictDoUpdate({
                        target: [voiceSessions.guildId, voiceSessions.userId],
                        set: next,
                    })
                    .run();
                return { revision: next.revision, completion: reward?.completion };
            },
            { behavior: 'immediate' },
        );
        this.revisions.set(key, result.revision);
        return result.completion;
    }
    snapshot(guild: Guild, initial: boolean) {
        if (!guild.available) return;
        const active = new Map<string, Position>();
        for (const state of guild.voiceStates.cache.values()) {
            if (state.channelId && state.member && !state.member.user.bot)
                active.set(state.id, position(state));
        }
        const rows = db
            .select()
            .from(voiceSessions)
            .where(
                and(
                    eq(voiceSessions.guildId, guild.id),
                    initial
                        ? undefined
                        : or(
                              isNotNull(voiceSessions.channelId),
                              inArray(voiceSessions.userId, [...active.keys()]),
                          ),
                ),
            )
            .all();
        for (const row of rows) {
            const key = guild.id + ':' + row.userId;
            // Do not let a slower stream overwrite a newer committed observation.
            if (
                !initial &&
                this.revisions.get(key) !== row.revision &&
                Date.now() - row.confirmedAt <= maxObservationGap
            ) {
                active.delete(row.userId);
                continue;
            }
            // A voice state without member metadata is not evidence of departure.
            const cached = guild.voiceStates.cache.get(row.userId);
            if (cached?.channelId && !cached.member) continue;
            const to = active.get(row.userId) ?? absent;
            if (initial && !same(row, to) && Date.now() - row.confirmedAt <= maxObservationGap) {
                // Another healthy stream may already have handled an event still queued
                // behind this READY snapshot. Let it remain authoritative until catch-up.
                this.revisions.set(key, Math.max(0, row.revision - 1));
                continue;
            }
            if (initial && !row.channelId && !to.channelId) {
                this.revisions.set(key, row.revision);
                continue;
            }
            active.delete(row.userId);
            const completion = this.observe(
                guild.id,
                row.userId,
                null,
                to,
                guild.client,
                Date.now(),
                row.revision,
            );
            void notify(guild.client, row.userId, completion).catch((error) =>
                logger.warn('Voice notification failed', { error }),
            );
        }
        for (const [user, to] of active)
            this.observe(
                guild.id,
                user,
                null,
                to,
                guild.client,
                Date.now(),
                this.revisions.get(guild.id + ':' + user) ?? 0,
            );
    }
}
export const voiceObserver = new VoiceObserver();
export async function notify(client: Client, id: string, completion?: string) {
    if (completion)
        await DMService.sendSuccessWithFallback(
            await client.users.fetch(id),
            'Tarea diaria completada',
            `Tarea diaria completada: **${completion}**\nUsa \`/daily\` para reclamar tu recompensa.`,
        );
}
export async function collectVoice(state: VoiceState) {
    const now = Date.now();
    const completion = db.transaction(
        (tx) => {
            const where = memberWhere(state.guild.id, state.id);
            const row = tx.select().from(voiceSessions).where(where).get();
            if (!row || !same(row, position(state))) return;
            const gap = now - row.confirmedAt > maxObservationGap;
            const reward = settle(row, gap ? row.confirmedAt : now, state.client, now);
            tx.update(voiceSessions)
                .set({ cursor: gap ? now : reward.cursor, confirmedAt: now })
                .where(where)
                .run();
            return reward.completion;
        },
        { behavior: 'immediate' },
    );
    await notify(state.client, state.id, completion);
}
