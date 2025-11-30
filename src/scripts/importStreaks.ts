import fs from 'fs';
import path from 'path';
import db from '../database/db.js';
import { streaks } from '../database/schema.js';
import logger from '../utils/logger.js';

const streaksPath = path.join(process.cwd(), 'data', 'streaks.json');

(async () => {
    try {
        if (!fs.existsSync(streaksPath)) {
            logger.warn('streaks.json not found, skipping import.');
            return;
        }

        const streaksData = JSON.parse(fs.readFileSync(streaksPath, 'utf8'));
        logger.info(`Found ${Object.keys(streaksData).length} streaks to import.`);

        let importedCount = 0;
        for (const [userId, data] of Object.entries(streaksData)) {
            let streak = 0;
            let lastDate = null;

            if (typeof data === 'number') {
                streak = data;
            } else if (typeof data === 'object' && data !== null) {
                const d = data as any;
                streak = d.streak || d.count || 0;
                lastDate = d.lastDate || d.date || null;
            }

            if (streak > 0) {
                await db.insert(streaks)
                    .values({ userId, streak, lastStreakDate: lastDate })
                    .onConflictDoUpdate({
                        target: streaks.userId,
                        set: { streak, lastStreakDate: lastDate }
                    });
                importedCount++;
            }
        }

        logger.info(`Imported ${importedCount} streaks successfully.`);
    } catch (error) {
        logger.error('Failed to import streaks:');
        console.error(error);
    }
})();
