import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';

const oldDbPath = '/home/ubuntu/snoojote/storage/database.sqlite';
const newDbPath = path.join(process.cwd(), 'data', 'database.sqlite');

if (!fs.existsSync(oldDbPath)) {
    console.log('Old database not found, skipping economy migration.');
    process.exit(0);
}

const oldDb = new Database(oldDbPath);
const newDb = new Database(newDbPath);

try {
    const oldUsers = oldDb.query("SELECT user_id, balance FROM users").all() as { user_id: string, balance: number }[];
    console.log(`Found ${oldUsers.length} users in old economy database.`);

    let migratedCount = 0;
    for (const user of oldUsers) {
        if (user.balance > 0) {
            newDb.query(`
                INSERT INTO users (user_id, points)
                VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET points = excluded.points
            `).run(user.user_id, user.balance);
            migratedCount++;
        }
    }
    console.log(`Migrated ${migratedCount} users' economy balances.`);
} catch (error) {
    console.error('Failed to migrate economy:', error);
} finally {
    oldDb.close();
    newDb.close();
}
