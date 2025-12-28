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
        const senderBalance = await this.getBalance(senderId);
        if (senderBalance < amount) return false;

        await this.addBalance(senderId, -amount);
        await this.addBalance(receiverId, amount);
        return true;
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

        // If user doesn't exist, create simple record first (or handled by upsert later)
        if (!user) {
            // We can't easily return a quest if user db record doesn't exist, so let's generate one and return it
            // The persistence will happen when we update progress or claim
            return questService.generateQuest(client);
        }

        const now = new Date();
        const lastActivity = user.lastActivityDate;

        // Check if we need to reset/generate a new quest for a new day
        const isNewDay = !lastActivity || lastActivity.getDate() !== now.getDate() || lastActivity.getMonth() !== now.getMonth();

        if (isNewDay || !user.dailyQuest) {
            const newQuest = await questService.generateQuest(client);
            // We should save this immediately so it persists
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
                        // Optional: Reset other daily counters if we had them
                    }
                });
            return newQuest;
        }

        // Return existing quest (parse checks if Drizzle handles JSON automatically, usually yes with mode: 'json')
        return user.dailyQuest as QuestData;
    }

    async updateQuestProgress(userId: string, type: string, increment: number, channelId?: string): Promise<QuestData | null> {
        const user = await db.select().from(users).where(eq(users.userId, userId)).get();
        if (!user || !user.dailyQuest) return null;

        const quest = user.dailyQuest as QuestData;

        // Check if quest matches type
        if (quest.type !== type) return null;
        if (quest.isCompleted) return quest; // Already done

        // Check target requirements
        if (quest.targetId && quest.targetId !== channelId) return null;

        // Update progress
        quest.current += increment;

        // Check completion
        const originallyCompleted = quest.isCompleted;
        const isNowCompleted = questService.checkCompletion(quest);

        await db.update(users)
            .set({ dailyQuest: quest })
            .where(eq(users.userId, userId));

        return quest;
    }

    async claimDaily(userId: string): Promise<{ success: boolean, message: string, reward?: number }> {
        const user = await db.select().from(users).where(eq(users.userId, userId)).get();
        if (!user) return { success: false, message: "User not found." };

        const now = new Date();
        const lastDaily = user.lastDaily;

        // Check if 24h passed
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

        // Check quest completion
        const quest = user.dailyQuest as QuestData;
        if (!quest || !quest.isCompleted) {
            return { success: false, message: "Daily Quest not completed yet!" };
        }

        // Award
        const reward = 250; // Fixed reward
        await this.addBalance(userId, reward);

        // Update lastDaily
        await db.update(users)
            .set({ lastDaily: now })
            .where(eq(users.userId, userId));

        return { success: true, message: "Daily reward claimed!", reward };
    }
}

export default new EconomyService();
