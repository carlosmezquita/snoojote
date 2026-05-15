import db from '../../../database/db.js';
import { economyDailyEarnings, streaks, users } from '../../../database/schema.js';
import { eq, sql, desc, and } from 'drizzle-orm';
import questService, { type QuestData } from './questService.js';
import { type DiscordBot } from '../../../core/client.js';
import { getDailyReward, getSpainDateKey } from '../../streaks/services/streakRules.js';
import logger from '../../../utils/logger.js';

export type EconomyEarningSource = 'MESSAGE' | 'VOICE';

export function calculateCappedEarning(
    currentAmount: number,
    requestedAmount: number,
    dailyCap: number,
): number {
    if (requestedAmount <= 0 || dailyCap <= 0) return 0;
    const remaining = Math.max(0, dailyCap - currentAmount);
    return Math.min(requestedAmount, remaining);
}

export class EconomyService {
    async getBalance(userId: string): Promise<number> {
        const user = await db
            .select({ points: users.points })
            .from(users)
            .where(eq(users.userId, userId))
            .get();
        return user ? user.points : 0;
    }

    async addBalance(userId: string, amount: number): Promise<void> {
        await db
            .insert(users)
            .values({ userId, points: amount })
            .onConflictDoUpdate({
                target: users.userId,
                set: { points: sql`${users.points} + ${amount}` },
            });
    }

    async addCappedEarning(
        userId: string,
        source: EconomyEarningSource,
        amount: number,
        dailyCap: number,
        now: Date = new Date(),
    ): Promise<number> {
        if (amount <= 0 || dailyCap <= 0) return 0;

        return db.transaction((tx) => {
            const dateKey = getSpainDateKey(now);
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

            const currentAmount = existing?.amount ?? 0;
            const creditedAmount = calculateCappedEarning(currentAmount, amount, dailyCap);
            if (creditedAmount <= 0) return 0;

            tx.insert(users)
                .values({ userId, points: creditedAmount })
                .onConflictDoUpdate({
                    target: users.userId,
                    set: { points: sql`${users.points} + ${creditedAmount}` },
                })
                .run();

            if (existing) {
                tx.update(economyDailyEarnings)
                    .set({ amount: currentAmount + creditedAmount })
                    .where(eq(economyDailyEarnings.id, existing.id))
                    .run();
            } else {
                tx.insert(economyDailyEarnings)
                    .values({
                        userId,
                        dateKey,
                        source,
                        amount: creditedAmount,
                    })
                    .run();
            }

            return creditedAmount;
        });
    }

    async spendBalance(userId: string, amount: number): Promise<boolean> {
        if (amount <= 0) return false;

        try {
            return db.transaction((tx) => {
                const spendResult = tx
                    .update(users)
                    .set({ points: sql`${users.points} - ${amount}` })
                    .where(and(eq(users.userId, userId), sql`${users.points} >= ${amount}`))
                    .returning({ userId: users.userId })
                    .get();

                if (!spendResult) {
                    tx.rollback();
                    return false;
                }

                return true;
            });
        } catch (e) {
            if (e instanceof Error && e.message.includes('Rollback')) {
                return false;
            }
            logger.error('Spend transaction failed', { userId, amount, error: e });
            return false;
        }
    }

    async transfer(senderId: string, receiverId: string, amount: number): Promise<boolean> {
        if (amount <= 0 || senderId === receiverId) return false;

        try {
            return db.transaction((tx) => {
                // Conditional update for the sender to ensure atomicity
                const debitResult = tx
                    .update(users)
                    .set({ points: sql`${users.points} - ${amount}` })
                    .where(and(eq(users.userId, senderId), sql`${users.points} >= ${amount}`))
                    .returning({ userId: users.userId })
                    .get();

                // If no rows were updated, either the user doesn't exist or they have insufficient funds
                if (!debitResult) {
                    tx.rollback();
                    return false;
                }

                // If debit was successful, credit the receiver
                tx.insert(users)
                    .values({ userId: receiverId, points: amount })
                    .onConflictDoUpdate({
                        target: users.userId,
                        set: { points: sql`${users.points} + ${amount}` },
                    })
                    .run();

                return true;
            });
        } catch (e) {
            // tx.rollback() throws a special rollback error that Drizzle catches,
            // but if it propagates or another error occurs, we catch it here.
            // Drizzle throws an error to abort the transaction.
            // If the error message is about rollback, we can return false.
            if (e instanceof Error && e.message.includes('Rollback')) {
                return false;
            }
            logger.error('Transfer transaction failed', { senderId, receiverId, amount, error: e });
            return false;
        }
    }

    async getLeaderboard(limit: number = 10): Promise<{ user_id: string; points: number }[]> {
        const leaderboard = await db
            .select({ user_id: users.userId, points: users.points })
            .from(users)
            .orderBy(desc(users.points))
            .limit(limit);

        return leaderboard;
    }

    async getCurrentDailyReward(userId: string): Promise<number> {
        const userStreak = await db
            .select({ streak: streaks.streak })
            .from(streaks)
            .where(eq(streaks.userId, userId))
            .get();

        return getDailyReward(userStreak?.streak ?? 0);
    }

    async getDailyQuest(userId: string, client: DiscordBot): Promise<QuestData> {
        const user = await db.select().from(users).where(eq(users.userId, userId)).get();

        if (!user) {
            return questService.generateQuest(client);
        }

        const now = new Date();
        const lastActivity = user.lastActivityDate;

        const isNewDay =
            !lastActivity ||
            lastActivity.getDate() !== now.getDate() ||
            lastActivity.getMonth() !== now.getMonth();

        if (isNewDay || !user.dailyQuest) {
            const newQuest = await questService.generateQuest(client);
            await db
                .insert(users)
                .values({
                    userId,
                    dailyQuest: newQuest,
                    lastActivityDate: now,
                })
                .onConflictDoUpdate({
                    target: users.userId,
                    set: {
                        dailyQuest: newQuest,
                        lastActivityDate: now,
                    },
                });
            return newQuest;
        }

        return user.dailyQuest as QuestData;
    }

    async updateQuestProgress(
        userId: string,
        type: string,
        increment: number,
        channelId?: string,
    ): Promise<QuestData | null> {
        const user = await db.select().from(users).where(eq(users.userId, userId)).get();
        if (!user || !user.dailyQuest) return null;

        // Clone/create a new object to ensure Drizzle sees it as a new value if that's the issue?
        // Or simply spread it.
        const quest: QuestData = { ...(user.dailyQuest as QuestData) };

        if (quest.type !== type) return null;
        if (quest.isCompleted) return quest;

        if (quest.targetId && quest.targetId !== channelId) return null;

        quest.current += increment;

        // Check completion - this function modifies 'quest' object in place (sets isCompleted = true)
        questService.checkCompletion(quest);

        await db.update(users).set({ dailyQuest: quest }).where(eq(users.userId, userId));

        return quest;
    }

    async claimDaily(
        userId: string,
    ): Promise<{ success: boolean; message: string; reward?: number }> {
        try {
            return db.transaction((tx) => {
                const user = tx.select().from(users).where(eq(users.userId, userId)).get();
                if (!user) return { success: false, message: 'Usuario no encontrado.' };

                const now = new Date();
                const lastDaily = user.lastDaily;

                if (lastDaily) {
                    const diff = now.getTime() - lastDaily.getTime();
                    const hours = diff / (1000 * 60 * 60);
                    if (hours < 24) {
                        const remaining = 24 - hours;
                        const h = Math.floor(remaining);
                        const m = Math.floor((remaining - h) * 60);
                        return {
                            success: false,
                            message: `Ya reclamada. Vuelve a intentarlo en ${h}h ${m}m.`,
                        };
                    }
                }

                const quest = user.dailyQuest as QuestData;

                if (!quest || !quest.isCompleted) {
                    return { success: false, message: 'La tarea diaria aún no está completada.' };
                }

                const userStreak = tx
                    .select({ streak: streaks.streak })
                    .from(streaks)
                    .where(eq(streaks.userId, userId))
                    .get();

                const reward = getDailyReward(userStreak?.streak ?? 0);

                // Atomic condition check for claimDaily: ensure lastDaily hasn't changed since we read it
                const updateResult = tx
                    .update(users)
                    .set({
                        points: sql`${users.points} + ${reward}`,
                        lastDaily: now,
                    })
                    .where(
                        and(
                            eq(users.userId, userId),
                            // Depending on lastDaily being null or having a specific timestamp
                            lastDaily === null
                                ? sql`last_daily IS NULL`
                                : eq(users.lastDaily, lastDaily),
                        ),
                    )
                    .returning({ userId: users.userId })
                    .get();

                if (!updateResult) {
                    tx.rollback();
                    return {
                        success: false,
                        message: 'No se pudo reclamar, posible solicitud simultánea.',
                    };
                }

                return { success: true, message: 'Recompensa diaria reclamada.', reward };
            });
        } catch (e) {
            if (e instanceof Error && e.message.includes('Rollback')) {
                return {
                    success: false,
                    message: 'No se pudo reclamar, posible solicitud simultánea.',
                };
            }
            logger.error('Claim daily transaction failed', { userId, error: e });
            return { success: false, message: 'Ha ocurrido un error.' };
        }
    }
}

export default new EconomyService();
