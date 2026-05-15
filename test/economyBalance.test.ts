import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import db from '../src/database/db.js';
import { economyDailyEarnings, economyTransactionLocks, users } from '../src/database/schema.js';
import economyService, {
    calculateCappedEarning,
} from '../src/features/economy/services/economyService.js';

const testRunId = `test-economy-${Date.now()}`;
const testUserIds = new Set<string>();

beforeAll(() => {
    db.run(sql`
        CREATE TABLE IF NOT EXISTS users (
            user_id text PRIMARY KEY NOT NULL,
            points integer DEFAULT 0 NOT NULL,
            level integer DEFAULT 1 NOT NULL,
            daily_quest text,
            last_daily integer,
            last_activity_date integer
        )
    `);
    db.run(sql`
        CREATE TABLE IF NOT EXISTS economy_daily_earnings (
            id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            user_id text NOT NULL,
            date_key text NOT NULL,
            source text NOT NULL,
            amount integer DEFAULT 0 NOT NULL
        )
    `);
    db.run(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS economy_daily_user_date_source_idx
        ON economy_daily_earnings (user_id, date_key, source)
    `);
    db.run(sql`
        CREATE TABLE IF NOT EXISTS economy_transaction_locks (
            lock_key text PRIMARY KEY NOT NULL,
            created_at integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
        )
    `);
});

const testUserId = (label: string) => {
    const userId = `${testRunId}-${label}`;
    testUserIds.add(userId);
    return userId;
};

const getStoredDailyEarning = (userId: string) =>
    db
        .select({ amount: economyDailyEarnings.amount })
        .from(economyDailyEarnings)
        .where(
            and(
                eq(economyDailyEarnings.userId, userId),
                eq(economyDailyEarnings.source, 'MESSAGE'),
            ),
        )
        .get()?.amount ?? 0;

afterEach(() => {
    const userIds = Array.from(testUserIds);
    if (userIds.length > 0) {
        db.delete(economyDailyEarnings).where(inArray(economyDailyEarnings.userId, userIds)).run();
        db.delete(users).where(inArray(users.userId, userIds)).run();
    }

    db.delete(economyTransactionLocks)
        .where(like(economyTransactionLocks.lockKey, `%${testRunId}%`))
        .run();

    testUserIds.clear();
});

describe('economy balance helpers', () => {
    test('caps passive earning at the configured daily limit', () => {
        expect(calculateCappedEarning(0, 5, 125)).toBe(5);
        expect(calculateCappedEarning(123, 5, 125)).toBe(2);
        expect(calculateCappedEarning(125, 5, 125)).toBe(0);
    });

    test('ignores invalid capped earning requests', () => {
        expect(calculateCappedEarning(0, 0, 125)).toBe(0);
        expect(calculateCappedEarning(0, 5, 0)).toBe(0);
    });

    test('concurrent spends cannot overdraw an account', async () => {
        const userId = testUserId('spender');
        await economyService.addBalance(userId, 50);

        const results = await Promise.all(
            Array.from({ length: 5 }, () => economyService.spendBalance(userId, 15)),
        );

        expect(results.filter(Boolean)).toHaveLength(3);
        expect(await economyService.getBalance(userId)).toBe(5);
    });

    test('concurrent transfers cannot spend the same balance twice', async () => {
        const senderId = testUserId('sender');
        const receiverId = testUserId('receiver');
        await economyService.addBalance(senderId, 100);

        const results = await Promise.all(
            Array.from({ length: 5 }, () => economyService.transfer(senderId, receiverId, 30)),
        );

        expect(results.filter(Boolean)).toHaveLength(3);
        expect(await economyService.getBalance(senderId)).toBe(10);
        expect(await economyService.getBalance(receiverId)).toBe(90);
    });

    test('opposite-direction transfers acquire locks consistently and preserve total money', async () => {
        const firstUserId = testUserId('first');
        const secondUserId = testUserId('second');
        await economyService.addBalance(firstUserId, 100);
        await economyService.addBalance(secondUserId, 100);

        const results = await Promise.all([
            ...Array.from({ length: 10 }, () =>
                economyService.transfer(firstUserId, secondUserId, 7),
            ),
            ...Array.from({ length: 10 }, () =>
                economyService.transfer(secondUserId, firstUserId, 5),
            ),
        ]);

        expect(results.every(Boolean)).toBe(true);
        expect(await economyService.getBalance(firstUserId)).toBe(80);
        expect(await economyService.getBalance(secondUserId)).toBe(120);
    });

    test('concurrent capped earnings cannot exceed the configured daily cap', async () => {
        const userId = testUserId('capped');
        const now = new Date('2026-05-15T10:00:00+02:00');

        const creditedAmounts = await Promise.all(
            Array.from({ length: 10 }, () =>
                economyService.addCappedEarning(userId, 'MESSAGE', 5, 12, now),
            ),
        );

        expect(creditedAmounts.reduce((sum, amount) => sum + amount, 0)).toBe(12);
        expect(await economyService.getBalance(userId)).toBe(12);
        expect(getStoredDailyEarning(userId)).toBe(12);
    });
});
