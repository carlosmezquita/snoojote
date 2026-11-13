import { type Message, type TextChannel } from 'discord.js';
import { asc, desc, eq, and, count, sql } from 'drizzle-orm';
import db from '../../../database/db.js';
import { shopItems, streaks, userInventory, users } from '../../../database/schema.js';
import { config } from '../../../config.js';
import type { Client } from 'discord.js';
import logger from '../../../utils/logger.js';
import {
    getNewMilestones,
    getStreakDateKey,
    getLastStreakDateKey,
    isConsecutiveDay,
    isWithinGracePeriod,
    MILESTONE_BONUSES,
} from './streakRules.js';

const BOT_CHANNEL_ID = config.channels.bot;
const STREAK_FREEZE_VALUE = 'STREAK_FREEZE';

export class StreakService {
    async notifyCheckIn(
        message: Message,
        client: Client,
        result: ReturnType<StreakService['recordCheckIn']>,
    ) {
        if (!result) return;
        const content = result.isNew
            ? `¡Hola ${message.author.toString()}! Has empezado tu primera racha. Para mantenerla, escribe **spaincraft** cada día en el canal de rachas.`
            : this.buildStreakMessage(
                  message,
                  result.streak,
                  result.remainingFreezes,
                  result.newMilestones,
              );
        const results = await Promise.allSettled([
            message.react(result.remainingFreezes === null ? '🔥' : '🧊'),
            this.sendBotMessage(client, content, message.author.id),
        ]);
        for (const outcome of results)
            if (outcome.status === 'rejected') {
                logger.warn('Streak recorded but notification failed', {
                    userId: message.author.id,
                    error: outcome.reason,
                });
            }
    }

    recordCheckIn(userId: string, now = new Date()) {
        const todayKey = getStreakDateKey(now);
        return db.transaction(
            (tx) => {
                const previous = tx.select().from(streaks).where(eq(streaks.userId, userId)).get();
                const previousDay = previous ? getLastStreakDateKey(previous) : null;
                if (
                    previousDay === todayKey ||
                    (previous?.lastStreakAt && previous.lastStreakAt > now)
                )
                    return null;
                const claimed = this.parseClaimedMilestones(previous?.claimedMilestones);
                let remainingFreezes: number | null = null;
                let streak = 1;
                if (previous) {
                    if (
                        isConsecutiveDay(previousDay, todayKey) ||
                        isWithinGracePeriod(previous.lastStreakAt, now)
                    ) {
                        streak = previous.streak + 1;
                    } else {
                        const slot = tx
                            .select({ id: userInventory.id })
                            .from(userInventory)
                            .innerJoin(shopItems, eq(shopItems.id, userInventory.itemId))
                            .where(
                                and(
                                    eq(userInventory.userId, userId),
                                    eq(shopItems.value, STREAK_FREEZE_VALUE),
                                ),
                            )
                            .orderBy(asc(userInventory.id))
                            .limit(1)
                            .get();
                        if (slot) {
                            tx.delete(userInventory).where(eq(userInventory.id, slot.id)).run();
                            remainingFreezes = this.countStreakFreezes(userId, tx);
                            streak = previous.streak + 1;
                        }
                    }
                }
                const newMilestones = getNewMilestones(streak, claimed);
                const update = {
                    streak,
                    highestStreak: Math.max(streak, previous?.highestStreak ?? 0),
                    lastStreakDate: todayKey,
                    lastStreakAt: now,
                    claimedMilestones: [...claimed, ...newMilestones],
                };
                tx.insert(streaks)
                    .values({ userId, ...update })
                    .onConflictDoUpdate({ target: streaks.userId, set: update })
                    .run();
                const reward = newMilestones.reduce(
                    (total, milestone) => total + MILESTONE_BONUSES[milestone],
                    0,
                );
                tx.insert(users)
                    .values({ userId, points: reward })
                    .onConflictDoUpdate({
                        target: users.userId,
                        set: { points: sql`${users.points} + ${reward}` },
                    })
                    .run();
                return { isNew: !previous, streak, remainingFreezes, newMilestones };
            },
            { behavior: 'immediate' },
        );
    }

    private buildStreakMessage(
        message: Message,
        streak: number,
        remainingFreezes: number | null,
        newMilestones: number[],
    ) {
        const lines = [`La racha actual de ${message.author.toString()} es de ${streak} días.`];

        if (remainingFreezes !== null) {
            lines.push('🧊 Se usó un seguro para proteger tu racha.');
            if (remainingFreezes === 0) {
                lines.push('No te quedan seguros. Puedes comprar otro con `/tienda`.');
            } else {
                lines.push(
                    remainingFreezes === 1
                        ? 'Te queda **1 seguro**.'
                        : `Te quedan **${remainingFreezes} seguros**.`,
                );
            }
        }

        for (const milestone of newMilestones) {
            lines.push(`🎁 Hito de ${milestone} días: +${MILESTONE_BONUSES[milestone]} ₧.`);
        }

        return lines.join('\n');
    }

    private async sendBotMessage(client: Client, content: string, userId: string) {
        const botChannel = client.channels.cache.get(BOT_CHANNEL_ID) as TextChannel;
        if (botChannel) {
            await botChannel.send({ content, allowedMentions: { parse: [], users: [userId] } });
        }
    }

    async getUserStreak(userId: string) {
        return await db.select().from(streaks).where(eq(streaks.userId, userId)).get();
    }

    async getTopStreaks(limit: number = 10) {
        return await db
            .select()
            .from(streaks)
            .orderBy(desc(streaks.highestStreak))
            .limit(limit)
            .all();
    }

    async getStreakFreezeCount(userId: string): Promise<number> {
        return this.countStreakFreezes(userId, db);
    }

    private countStreakFreezes(userId: string, query: Pick<typeof db, 'select'>): number {
        return (
            query
                .select({ value: count() })
                .from(userInventory)
                .innerJoin(shopItems, eq(shopItems.id, userInventory.itemId))
                .where(
                    and(eq(userInventory.userId, userId), eq(shopItems.value, STREAK_FREEZE_VALUE)),
                )
                .get()?.value ?? 0
        );
    }

    private parseClaimedMilestones(value: unknown): number[] {
        if (Array.isArray(value)) {
            return value.filter((item): item is number => typeof item === 'number');
        }
        return [];
    }
}

export default new StreakService();
