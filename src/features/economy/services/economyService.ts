import db from '../../../database/db.js';
import { economyDailyEarnings, streaks, users } from '../../../database/schema.js';
import { eq, sql, desc, and } from 'drizzle-orm';
import questService, { type QuestData } from './questService.js';
import { type DiscordBot } from '../../../core/client.js';
import {
    getDailyReward,
    getSpainDateKey,
    getStreakDateKey,
    getLastStreakDateKey,
    isConsecutiveDay,
    isWithinGracePeriod,
} from '../../streaks/services/streakRules.js';

export type EconomyEarningSource = 'MESSAGE' | 'VOICE';
const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;

export function calculateCappedEarning(
    currentAmount: number,
    requestedAmount: number,
    dailyCap: number,
): number {
    if (
        !Number.isSafeInteger(currentAmount) ||
        currentAmount < 0 ||
        !positiveInteger(requestedAmount) ||
        !positiveInteger(dailyCap)
    )
        return 0;
    return Math.min(requestedAmount, Math.max(0, dailyCap - currentAmount));
}

// All SQLite write transactions are synchronous. No network await or application
// lock table belongs inside them; conditional SQL owns the balance invariants.
export class EconomyService {
    async getBalance(userId: string): Promise<number> {
        return (
            db.select({ points: users.points }).from(users).where(eq(users.userId, userId)).get()
                ?.points ?? 0
        );
    }

    async addBalance(userId: string, amount: number): Promise<void> {
        if (!positiveInteger(amount)) throw new Error('Amount must be a positive safe integer');
        db.insert(users)
            .values({ userId, points: amount })
            .onConflictDoUpdate({
                target: users.userId,
                set: { points: sql`${users.points} + ${amount}` },
            })
            .run();
    }

    async addCappedEarning(
        userId: string,
        source: EconomyEarningSource,
        amount: number,
        dailyCap: number,
        now = new Date(),
    ): Promise<number> {
        if (!positiveInteger(amount) || !positiveInteger(dailyCap)) return 0;
        const dateKey = getSpainDateKey(now);
        return db.transaction(
            (tx) => {
                const existing = tx
                    .select()
                    .from(economyDailyEarnings)
                    .where(
                        and(
                            eq(economyDailyEarnings.userId, userId),
                            eq(economyDailyEarnings.dateKey, dateKey),
                            eq(economyDailyEarnings.source, source),
                        ),
                    )
                    .get();
                const credited = calculateCappedEarning(existing?.amount ?? 0, amount, dailyCap);
                if (!credited) return 0;
                tx.insert(users)
                    .values({ userId, points: credited })
                    .onConflictDoUpdate({
                        target: users.userId,
                        set: { points: sql`${users.points} + ${credited}` },
                    })
                    .run();
                tx.insert(economyDailyEarnings)
                    .values({ userId, dateKey, source, amount: credited })
                    .onConflictDoUpdate({
                        target: [
                            economyDailyEarnings.userId,
                            economyDailyEarnings.dateKey,
                            economyDailyEarnings.source,
                        ],
                        set: { amount: sql`${economyDailyEarnings.amount} + ${credited}` },
                    })
                    .run();
                return credited;
            },
            { behavior: 'immediate' },
        );
    }

    async spendBalance(userId: string, amount: number): Promise<boolean> {
        if (!positiveInteger(amount)) return false;
        return !!db
            .update(users)
            .set({ points: sql`${users.points} - ${amount}` })
            .where(and(eq(users.userId, userId), sql`${users.points} >= ${amount}`))
            .returning({ id: users.userId })
            .get();
    }

    async transfer(senderId: string, receiverId: string, amount: number): Promise<boolean> {
        if (!positiveInteger(amount) || senderId === receiverId) return false;
        return db.transaction(
            (tx) => {
                const debit = tx
                    .update(users)
                    .set({ points: sql`${users.points} - ${amount}` })
                    .where(and(eq(users.userId, senderId), sql`${users.points} >= ${amount}`))
                    .returning()
                    .get();
                if (!debit) return false;
                tx.insert(users)
                    .values({ userId: receiverId, points: amount })
                    .onConflictDoUpdate({
                        target: users.userId,
                        set: { points: sql`${users.points} + ${amount}` },
                    })
                    .run();
                return true;
            },
            { behavior: 'immediate' },
        );
    }

    async getLeaderboard(limit = 10): Promise<{ user_id: string; points: number }[]> {
        return db
            .select({ user_id: users.userId, points: users.points })
            .from(users)
            .orderBy(desc(users.points))
            .limit(Math.max(1, Math.min(limit, 25)))
            .all();
    }

    async getCurrentDailyReward(userId: string, now = new Date()): Promise<number> {
        return getDailyReward(
            activeStreak(db.select().from(streaks).where(eq(streaks.userId, userId)).get(), now),
        );
    }

    async getDailyQuest(userId: string, client: DiscordBot, now = new Date()): Promise<QuestData> {
        return db.transaction(
            (tx) => {
                const user = tx.select().from(users).where(eq(users.userId, userId)).get();
                if (
                    user?.dailyQuest &&
                    user.lastActivityDate &&
                    getSpainDateKey(user.lastActivityDate) === getSpainDateKey(now)
                )
                    return user.dailyQuest as QuestData;
                const quest = questService.generateQuest(client, userId);
                tx.insert(users)
                    .values({ userId, dailyQuest: quest, lastActivityDate: now })
                    .onConflictDoUpdate({
                        target: users.userId,
                        set: { dailyQuest: quest, lastActivityDate: now },
                    })
                    .run();
                return quest;
            },
            { behavior: 'immediate' },
        );
    }

    async updateQuestProgress(
        userId: string,
        type: string,
        increment: number,
        channelId?: string,
        now = new Date(),
    ): Promise<QuestData | null> {
        if (!positiveInteger(increment)) return null;
        return db.transaction(
            (tx) => {
                const user = tx.select().from(users).where(eq(users.userId, userId)).get();
                if (
                    !user?.dailyQuest ||
                    !user.lastActivityDate ||
                    getSpainDateKey(user.lastActivityDate) !== getSpainDateKey(now)
                )
                    return null;
                const quest = { ...(user.dailyQuest as QuestData) };
                if (
                    quest.type !== type ||
                    quest.isCompleted ||
                    (quest.targetId && quest.targetId !== channelId)
                )
                    return null;
                quest.current = Math.min(quest.goal, quest.current + increment);
                questService.checkCompletion(quest);
                tx.update(users).set({ dailyQuest: quest }).where(eq(users.userId, userId)).run();
                return quest;
            },
            { behavior: 'immediate' },
        );
    }

    async claimDaily(
        userId: string,
        now = new Date(),
    ): Promise<{ success: boolean; message: string; reward?: number }> {
        return db.transaction(
            (tx) => {
                const user = tx.select().from(users).where(eq(users.userId, userId)).get();
                if (!user) return { success: false, message: 'Usuario no encontrado.' };
                if (user.lastDaily && now.getTime() - user.lastDaily.getTime() < 86_400_000) {
                    const remaining = Math.ceil(
                        (86_400_000 - (now.getTime() - user.lastDaily.getTime())) / 60_000,
                    );
                    return {
                        success: false,
                        message: `Ya reclamada. Vuelve a intentarlo en ${Math.floor(remaining / 60)}h ${remaining % 60}m.`,
                    };
                }
                const quest = user.dailyQuest as QuestData | null;
                if (
                    !quest?.isCompleted ||
                    !user.lastActivityDate ||
                    getSpainDateKey(user.lastActivityDate) !== getSpainDateKey(now)
                ) {
                    return { success: false, message: 'La tarea diaria aún no está completada.' };
                }
                const reward = getDailyReward(
                    activeStreak(
                        tx.select().from(streaks).where(eq(streaks.userId, userId)).get(),
                        now,
                    ),
                );
                tx.update(users)
                    .set({ points: sql`${users.points} + ${reward}`, lastDaily: now })
                    .where(eq(users.userId, userId))
                    .run();
                return { success: true, message: 'Recompensa diaria reclamada.', reward };
            },
            { behavior: 'immediate' },
        );
    }
}
function activeStreak(streak: typeof streaks.$inferSelect | undefined, now: Date): number {
    if (!streak) return 0;
    const today = getStreakDateKey(now);
    const previousDay = getLastStreakDateKey(streak);
    return previousDay === today ||
        isConsecutiveDay(previousDay, today) ||
        isWithinGracePeriod(streak.lastStreakAt, now)
        ? streak.streak
        : 0;
}
export default new EconomyService();
