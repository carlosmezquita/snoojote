import db from '../../../database/db.js';
import { users } from '../../../database/schema.js';
import { eq, sql, desc } from 'drizzle-orm';

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
}

export default new EconomyService();
