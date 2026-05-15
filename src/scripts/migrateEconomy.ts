import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

const oldDbPath = '/home/ubuntu/snoojote/storage/database.sqlite';
const newDbPath = path.join(process.cwd(), 'data', 'database.sqlite');

if (!fs.existsSync(oldDbPath)) {
    logger.info('Old database not found, skipping economy migration', { oldDbPath });
    process.exit(0);
}

const oldDb = new Database(oldDbPath);
const newDb = new Database(newDbPath);

try {
    const oldUsers = oldDb.query('SELECT user_id, balance FROM users').all() as {
        user_id: string;
        balance: number;
    }[];
    logger.info('Found users in old economy database', { userCount: oldUsers.length });

    let migratedCount = 0;
    for (const user of oldUsers) {
        if (user.balance > 0) {
            newDb
                .query(
                    `
                INSERT INTO users (user_id, points)
                VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET points = excluded.points
            `,
                )
                .run(user.user_id, user.balance);
            migratedCount++;
        }
    }
    logger.info('Migrated economy balances', { migratedCount });
} catch (error) {
    logger.error('Failed to migrate economy', { error });
} finally {
    oldDb.close();
    newDb.close();
}
