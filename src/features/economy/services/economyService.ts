import db from '../../../database/index.js';

export class EconomyService {
    async getBalance(userId: string): Promise<number> {
        const user = await db.get<{ user_id: string, points: number }>('SELECT points FROM users WHERE user_id = ?', [userId]);
        return user ? user.points : 0;
    }

    async addBalance(userId: string, amount: number): Promise<void> {
        const user = await db.get<{ user_id: string, points: number }>('SELECT points FROM users WHERE user_id = ?', [userId]);

        if (user) {
            await db.run('UPDATE users SET points = points + ? WHERE user_id = ?', [amount, userId]);
        } else {
            await db.run('INSERT INTO users (user_id, points) VALUES (?, ?)', [userId, amount]);
        }
    }

    async transfer(senderId: string, receiverId: string, amount: number): Promise<boolean> {
        const senderBalance = await this.getBalance(senderId);
        if (senderBalance < amount) return false;

        await this.addBalance(senderId, -amount);
        await this.addBalance(receiverId, amount);
        return true;
    }

    async getLeaderboard(limit: number = 10): Promise<{ user_id: string, points: number }[]> {
        return await db.all<{ user_id: string, points: number }>(`SELECT user_id, points FROM users ORDER BY points DESC LIMIT ?`, [limit]);
    }
}

export default new EconomyService();
