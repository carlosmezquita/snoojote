import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { Collection } from 'discord.js';
import { eq, sql } from 'drizzle-orm';
import db from '../src/database/db.js';
import {
    users,
    streaks,
    shopItems,
    userInventory,
    economyDailyEarnings,
} from '../src/database/schema.js';
import { type DiscordBot } from '../src/core/client.js';
import { EconomyService } from '../src/features/economy/services/economyService.js';
import { QuestType } from '../src/features/economy/services/questService.js';
import { StreakService } from '../src/features/streaks/services/StreakService.js';
import {
    getSpainDateKey,
    MILESTONE_BONUSES,
    getDailyReward,
} from '../src/features/streaks/services/streakRules.js';
import messageRewards from '../src/features/economy/events/messageCreate.js';
import { config } from '../src/config.js';

const identifiers: string[] = [];
const itemIds: number[] = [];
const client = { channels: { cache: new Collection() } } as unknown as DiscordBot;
const economy = new EconomyService();
function user() {
    const id = randomUUID();
    identifiers.push(id);
    db.insert(users).values({ userId: id, points: 100 }).run();
    return id;
}
afterEach(() => {
    db.run(sql`DROP TRIGGER IF EXISTS fail_streak_credit`);
    for (const id of identifiers.splice(0)) {
        db.delete(economyDailyEarnings).where(eq(economyDailyEarnings.userId, id)).run();
        db.delete(userInventory).where(eq(userInventory.userId, id)).run();
        db.delete(streaks).where(eq(streaks.userId, id)).run();
        db.delete(users).where(eq(users.userId, id)).run();
    }
    for (const id of itemIds.splice(0)) db.delete(shopItems).where(eq(shopItems.id, id)).run();
});
const quest = {
    type: QuestType.MESSAGE_COUNT,
    current: 0,
    goal: 20,
    description: 'Test',
    isCompleted: false,
};

describe('economy transactions', () => {
    test('a new user receives a persisted quest', async () => {
        const id = randomUUID();
        identifiers.push(id);
        const generated = await economy.getDailyQuest(id, client);
        expect(db.select().from(users).where(eq(users.userId, id)).get()!.dailyQuest).toEqual(
            generated,
        );
        expect(await economy.getDailyQuest(id, client)).toEqual(generated);
    });

    test('quest rollover uses Madrid dates and the full calendar year', async () => {
        const id = user();
        const now = new Date('2026-12-31T23:30:00Z');
        db.update(users)
            .set({
                dailyQuest: { ...quest, current: 17 },
                lastActivityDate: new Date('2026-12-31T00:00:00Z'),
            })
            .where(eq(users.userId, id))
            .run();
        expect((await economy.getDailyQuest(id, client, now)).current).toBe(0);
        db.update(users)
            .set({
                dailyQuest: { ...quest, current: 19 },
                lastActivityDate: new Date('2026-01-01T00:00:00Z'),
            })
            .where(eq(users.userId, id))
            .run();
        expect((await economy.getDailyQuest(id, client, now)).current).toBe(0);
    });

    test('competing progress increments are preserved and completion is reported once', async () => {
        const id = user();
        const now = new Date();
        db.update(users)
            .set({ dailyQuest: quest, lastActivityDate: now })
            .where(eq(users.userId, id))
            .run();
        const results = await Promise.all(
            Array.from({ length: 100 }, () =>
                economy.updateQuestProgress(id, QuestType.MESSAGE_COUNT, 1, undefined, now),
            ),
        );
        expect(results.filter((result) => result?.isCompleted)).toHaveLength(1);
        expect(
            (db.select().from(users).where(eq(users.userId, id)).get()!.dailyQuest as typeof quest)
                .current,
        ).toBe(20);
        const claims = await Promise.all(
            Array.from({ length: 10 }, () => economy.claimDaily(id, now)),
        );
        expect(claims.filter((claim) => claim.success)).toHaveLength(1);
        expect(await economy.getBalance(id)).toBe(100 + getDailyReward(0));
    });

    test('yesterday’s completed quest cannot be claimed today', async () => {
        const id = user();
        const now = new Date();
        db.update(users)
            .set({
                dailyQuest: { ...quest, isCompleted: true },
                lastActivityDate: new Date(now.getTime() - 2 * 86_400_000),
            })
            .where(eq(users.userId, id))
            .run();
        expect((await economy.claimDaily(id, now)).success).toBe(false);
    });

    test('database rejects unsafe credits and transfer rolls back both accounts', async () => {
        const sender = user();
        const receiver = user();
        db.update(users)
            .set({ points: Number.MAX_SAFE_INTEGER })
            .where(eq(users.userId, receiver))
            .run();
        await expect(economy.addBalance(receiver, 1)).rejects.toThrow();
        await expect(economy.transfer(sender, receiver, 10)).rejects.toThrow();
        expect(await economy.getBalance(sender)).toBe(100);
        expect(await economy.getBalance(receiver)).toBe(Number.MAX_SAFE_INTEGER);
        for (const invalid of [NaN, Infinity, -1, 0.5])
            expect(await economy.spendBalance(sender, invalid)).toBe(false);
    });

    test('a simultaneous message burst consumes one reward cooldown', async () => {
        const id = user();
        const message = {
            author: { id, bot: false },
            guild: { id: 'guild' },
            guildId: 'guild',
            channelId: 'public-test',
            content: 'meaningful message',
            client,
            reply: async () => {},
        };
        await Promise.all(
            Array.from({ length: 100 }, () => messageRewards.execute(message as never)),
        );
        const balance = await economy.getBalance(id);
        expect(balance).toBeGreaterThan(100);
        expect(balance).toBeLessThanOrEqual(100 + config.economy.messageRewards.max);
    });
});

describe('atomic streak check-ins', () => {
    const milestone = Object.keys(MILESTONE_BONUSES)
        .map(Number)
        .filter((day) => day > 1)
        .sort((a, b) => a - b)[0];
    test('concurrent check-ins award a milestone once', async () => {
        const id = user();
        const now = new Date('2026-05-20T12:00:00Z');
        const yesterday = new Date(now.getTime() - 86_400_000);
        db.insert(streaks)
            .values({
                userId: id,
                streak: milestone - 1,
                highestStreak: milestone - 1,
                lastStreakDate: getSpainDateKey(yesterday),
                lastStreakAt: yesterday,
                claimedMilestones: [],
            })
            .run();
        const service = new StreakService();
        const results = await Promise.all(
            Array.from({ length: 50 }, async () => service.recordCheckIn(id, now)),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await economy.getBalance(id)).toBe(100 + MILESTONE_BONUSES[milestone]);
        expect((await service.getUserStreak(id))!.streak).toBe(milestone);
    });

    test('concurrent expired check-ins consume only one freeze', async () => {
        const id = user();
        const now = new Date('2026-05-20T12:00:00Z');
        db.insert(streaks)
            .values({
                userId: id,
                streak: 3,
                lastStreakDate: '2026-05-10',
                lastStreakAt: new Date('2026-05-10T12:00:00Z'),
            })
            .run();
        const item = db
            .insert(shopItems)
            .values({
                name: randomUUID(),
                description: 'freeze',
                price: 1,
                type: 'CONSUMABLE',
                value: 'STREAK_FREEZE',
            })
            .returning()
            .get();
        itemIds.push(item.id);
        db.insert(userInventory)
            .values([
                { userId: id, itemId: item.id },
                { userId: id, itemId: item.id },
            ])
            .run();
        const service = new StreakService();
        await Promise.all(Array.from({ length: 30 }, async () => service.recordCheckIn(id, now)));
        expect(await service.getStreakFreezeCount(id)).toBe(1);
        expect((await service.getUserStreak(id))!.streak).toBe(4);
    });

    test('failed milestone credit rolls back the streak and can be retried', async () => {
        const id = user();
        const now = new Date('2026-05-20T12:00:00Z');
        const yesterday = new Date(now.getTime() - 86_400_000);
        db.insert(streaks)
            .values({
                userId: id,
                streak: milestone - 1,
                lastStreakDate: getSpainDateKey(yesterday),
                lastStreakAt: yesterday,
            })
            .run();
        db.run(
            sql`CREATE TEMP TRIGGER fail_streak_credit BEFORE UPDATE OF points ON users BEGIN SELECT RAISE(FAIL, 'test credit failure'); END`,
        );
        const service = new StreakService();
        expect(() => service.recordCheckIn(id, now)).toThrow();
        expect((await service.getUserStreak(id))!.streak).toBe(milestone - 1);
        db.run(sql`DROP TRIGGER fail_streak_credit`);
        expect(service.recordCheckIn(id, now)?.streak).toBe(milestone);
        expect(await economy.getBalance(id)).toBe(100 + MILESTONE_BONUSES[milestone]);
    });
});
