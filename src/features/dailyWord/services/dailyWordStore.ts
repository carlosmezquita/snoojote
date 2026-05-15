import { eq } from 'drizzle-orm';
import db from '../../../database/db.js';
import { dailyWordCache } from '../../../database/schema.js';
import {
    type DailyWordCacheEntry,
    type DailyWordCacheStatus,
    type DailyWordStore,
} from './dailyWordService.js';
import { type WordEntryData } from './raeService.js';

export class DrizzleDailyWordStore implements DailyWordStore {
    async get(dateKey: string): Promise<DailyWordCacheEntry | null> {
        const row = await db.query.dailyWordCache.findFirst({
            where: eq(dailyWordCache.dateKey, dateKey),
        });

        if (!row) return null;

        return {
            dateKey: row.dateKey,
            status: row.status as DailyWordCacheStatus,
            word: row.word,
            definitionData: row.definitionData as WordEntryData | null,
            attempts: row.attempts,
            firstAttemptAt: row.firstAttemptAt,
            lastAttemptAt: row.lastAttemptAt,
            nextAttemptAt: row.nextAttemptAt,
            preparedAt: row.preparedAt,
            postedAt: row.postedAt,
            lastError: row.lastError,
        };
    }

    async upsert(entry: DailyWordCacheEntry): Promise<void> {
        const { dateKey: _dateKey, ...data } = entry;

        await db.insert(dailyWordCache).values(entry).onConflictDoUpdate({
            target: dailyWordCache.dateKey,
            set: data,
        });
    }
}
