import db from '../../../database/db.js';
import { users } from '../../../database/schema.js';
import { eq, sql, desc, and } from 'drizzle-orm';
import questService, { QuestData } from './questService.js';
import { DiscordBot } from '../../../core/client.js';

export class EconomyService {
    async getBalance(userId: string): Promise<number> {
        const user = await db.select({ points: users.points })
            .from(users)
            .where(eq(users.userId, userId))
            .get();
        return user ? user.points : 0;
    }

    async addBalance(userId: string, amount: number): Promise<void> {
        await db.insert(users)
            .values({ userId, points: amount })
            .onConflictDoUpdate({
                target: users.userId,
                set: { points: sql`${users.points} + ${amount}` }
            });
    }

    async transfer(senderId: string, receiverId: string, amount: number): Promise<boolean> {
        if (amount <= 0 || senderId === receiverId) return false;

        try {
            return db.transaction((tx) => {
                const currentSender = tx.select({ points: users.points })
                    .from(users)
                    .where(eq(users.userId, senderId))
                    .get();

                if (!currentSender || currentSender.points < amount) return false;

                tx.update(users)
                    .set({ points: sql`${users.points} - ${amount}` })
                    .where(eq(users.userId, senderId))
                    .run();

                tx.insert(users)
                    .values({ userId: receiverId, points: amount })
                    .onConflictDoUpdate({
                        target: users.userId,
                        set: { points: sql`${users.points} + ${amount}` }
                    })
                    .run();

                return true;
            });
        } catch (e) {
            console.error("Transfer transaction failed:", e);
            return false;
        }
    }

    async getLeaderboard(limit: number = 10): Promise<{ user_id: string, points: number }[]> {
        const leaderboard = await db.select({ user_id: users.userId, points: users.points })
            .from(users)
            .orderBy(desc(users.points))
            .limit(limit);

        return leaderboard;
    }

    async getDailyQuest(userId: string, client: DiscordBot): Promise<QuestData> {
        let user = await db.select().from(users).where(eq(users.userId, userId)).get();

        if (!user) {
            return questService.generateQuest(client);
        }

        const now = new Date();
        const lastActivity = user.lastActivityDate;

        const isNewDay = !lastActivity || lastActivity.getDate() !== now.getDate() || lastActivity.getMonth() !== now.getMonth();

        if (isNewDay || !user.dailyQuest) {
            const newQuest = await questService.generateQuest(client);
            await db.insert(users)
                .values({
                    userId,
                    dailyQuest: newQuest,
                    lastActivityDate: now
                })
                .onConflictDoUpdate({
                    target: users.userId,
                    set: {
                        dailyQuest: newQuest,
                        lastActivityDate: now,
                    }
                });
            return newQuest;
        }

        return user.dailyQuest as QuestData;
    }

    async updateQuestProgress(userId: string, type: string, increment: number, channelId?: string): Promise<QuestData | null> {
        const user = await db.select().from(users).where(eq(users.userId, userId)).get();
        if (!user || !user.dailyQuest) return null;

        // Clone/create a new object to ensure Drizzle sees it as a new value if that's the issue?
        // Or simply spread it.
        const quest: QuestData = { ...user.dailyQuest as QuestData };

        if (quest.type !== type) return null;
        if (quest.isCompleted) return quest;

        if (quest.targetId && quest.targetId !== channelId) return null;

        quest.current += increment;

        // Check completion - this function modifies 'quest' object in place (sets isCompleted = true)
        questService.checkCompletion(quest);

        await db.update(users)
            .set({ dailyQuest: quest })
            .where(eq(users.userId, userId));

        return quest;
    }

    async claimDaily(userId: string): Promise<{ success: boolean, message: string, reward?: number }> {
        try {
            return db.transaction((tx) => {
                const user = tx.select().from(users).where(eq(users.userId, userId)).get();
                if (!user) return { success: false, message: "User not found." };

                const now = new Date();
                const lastDaily = user.lastDaily;

                if (lastDaily) {
                    const diff = now.getTime() - lastDaily.getTime();
                    const hours = diff / (1000 * 60 * 60);
                    if (hours < 24) {
                        const remaining = 24 - hours;
                        const h = Math.floor(remaining);
                        const m = Math.floor((remaining - h) * 60);
                        return { success: false, message: `Already claimed. Try again in ${h}h ${m}m.` };
                    }
                }

                const quest = user.dailyQuest as QuestData;

                if (!quest || !quest.isCompleted) {
                    return { success: false, message: "Daily Quest not completed yet!" };
                }

                const reward = 250;

                tx.update(users)
                    .set({
                        points: sql`${users.points} + ${reward}`,
                        lastDaily: now
                    })
                    .where(eq(users.userId, userId))
                    .run();

                return { success: true, message: "Daily reward claimed!", reward };
            });
        } catch (e) {
             console.error("Claim Daily transaction failed:", e);
             return { success: false, message: "An error occurred." };
        }
    }
}

export default new EconomyService();
