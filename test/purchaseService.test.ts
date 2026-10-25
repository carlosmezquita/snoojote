import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import db from '../src/database/db.js';
import { shopItems, shopPurchases, userInventory, users } from '../src/database/schema.js';
import {
    PurchaseService,
    type RoleDelivery,
} from '../src/features/economy/services/purchaseService.js';

const fixtures: { userId: string; itemId: number }[] = [];
function fixture(roleWasOwned = false) {
    const userId = randomUUID();
    const item = db
        .insert(shopItems)
        .values({ name: userId, description: 'Test', price: 30, type: 'ROLE', value: 'role' })
        .returning()
        .get();
    db.insert(users).values({ userId, points: 100 }).run();
    fixtures.push({ userId, itemId: item.id });
    const service = new PurchaseService();
    const input = {
        userId,
        guildId: 'guild',
        itemId: item.id,
        price: 30,
        roleId: 'role',
        roleWasOwned,
        consumable: false,
    };
    let owned = roleWasOwned;
    const roles: RoleDelivery = {
        hasRole: async () => owned,
        addRole: async () => {
            owned = true;
        },
        removeRole: async () => {
            owned = false;
        },
    };
    return {
        service,
        input,
        roles,
        owned: () => owned,
        balance: () => db.select().from(users).where(eq(users.userId, userId)).get()!.points,
        inventory: () =>
            db.select().from(userInventory).where(eq(userInventory.userId, userId)).all(),
    };
}

afterEach(() => {
    db.run(sql`DROP TRIGGER IF EXISTS fail_inventory`);
    db.run(sql`DROP TRIGGER IF EXISTS fail_refund`);
    db.run(sql`DROP TRIGGER IF EXISTS fail_purchase`);
    for (const { userId, itemId } of fixtures.splice(0)) {
        db.delete(shopPurchases).where(eq(shopPurchases.userId, userId)).run();
        db.delete(userInventory).where(eq(userInventory.userId, userId)).run();
        db.delete(users).where(eq(users.userId, userId)).run();
        db.delete(shopItems).where(eq(shopItems.id, itemId)).run();
    }
});

const failInventory = () =>
    db.run(sql`CREATE TEMP TRIGGER fail_inventory BEFORE INSERT ON user_inventory
    BEGIN SELECT RAISE(FAIL, 'inventory unavailable'); END`);

describe('purchase consistency and recovery', () => {
    test('journal failure rolls back the debit', () => {
        const f = fixture();
        db.run(sql`CREATE TEMP TRIGGER fail_purchase BEFORE INSERT ON shop_purchases
            BEGIN SELECT RAISE(FAIL, 'journal unavailable'); END`);
        expect(() => f.service.reserve(f.input)).toThrow('journal unavailable');
        expect(f.balance()).toBe(100);
    });

    test('unconfirmed role removal never triggers a refund', async () => {
        const f = fixture();
        failInventory();
        f.roles.removeRole = async () => {};
        expect(await f.service.deliver(f.service.reserve(f.input)!, f.roles)).toBe('pending');
        expect(f.owned()).toBe(true);
        expect(f.balance()).toBe(70);
    });

    test('debits once and completes role delivery and inventory', async () => {
        const f = fixture();
        const purchase = f.service.reserve(f.input)!;
        expect(await f.service.deliver(purchase, f.roles)).toBe('completed');
        expect(f.balance()).toBe(70);
        expect(f.owned()).toBe(true);
        expect(f.inventory()).toHaveLength(1);
        await f.service.deliver(purchase, f.roles);
        expect(f.balance()).toBe(70);
        expect(f.inventory()).toHaveLength(1);
    });

    test('rejects insufficient funds without a journal or debit', () => {
        const f = fixture();
        expect(f.service.reserve({ ...f.input, price: 101 })).toBeNull();
        expect(f.balance()).toBe(100);
        expect(f.service.pending().filter((p) => p.userId === f.input.userId)).toHaveLength(0);
    });

    test('competing reservations cannot debit the same user twice', async () => {
        const f = fixture();
        const results = await Promise.all(
            Array.from({ length: 5 }, async () => f.service.reserve(f.input)),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(f.balance()).toBe(70);
    });

    test('a failed grant refunds exactly once', async () => {
        const f = fixture();
        f.roles.addRole = async () => {
            throw new Error('Missing permissions');
        };
        const purchase = f.service.reserve(f.input)!;
        expect(await f.service.deliver(purchase, f.roles)).toBe('refunded');
        await f.service.deliver(purchase, f.roles);
        expect(f.balance()).toBe(100);
        expect(f.inventory()).toHaveLength(0);
    });

    test('compensates a grant accepted by Discord before a network error', async () => {
        const f = fixture();
        const add = f.roles.addRole;
        f.roles.addRole = async (p) => {
            await add(p);
            throw new Error('Connection reset');
        };
        expect(await f.service.deliver(f.service.reserve(f.input)!, f.roles)).toBe('refunded');
        expect(f.owned()).toBe(false);
        expect(f.balance()).toBe(100);
    });

    test('inventory failure revokes a new role before refunding', async () => {
        const f = fixture();
        failInventory();
        expect(await f.service.deliver(f.service.reserve(f.input)!, f.roles)).toBe('refunded');
        expect(f.owned()).toBe(false);
        expect(f.inventory()).toHaveLength(0);
        expect(f.balance()).toBe(100);
    });

    test('never revokes a role owned before the purchase', async () => {
        const f = fixture(true);
        failInventory();
        expect(await f.service.deliver(f.service.reserve(f.input)!, f.roles)).toBe('refunded');
        expect(f.owned()).toBe(true);
        expect(f.balance()).toBe(100);
    });

    test('failed compensation stays pending and recovers after a restart', async () => {
        const f = fixture();
        failInventory();
        f.roles.removeRole = async () => {
            throw new Error('Discord unavailable');
        };
        const purchase = f.service.reserve(f.input)!;
        expect(await f.service.deliver(purchase, f.roles)).toBe('pending');
        expect(f.balance()).toBe(70);
        expect(f.service.reserve(f.input)).toBeNull();
        db.run(sql`DROP TRIGGER fail_inventory`);
        await new PurchaseService().recover(f.roles);
        expect(f.balance()).toBe(70);
        expect(f.owned()).toBe(true);
        expect(f.inventory()).toHaveLength(1);
    });

    test('failed refund rolls back its status and can be retried exactly once', async () => {
        const f = fixture();
        f.roles.addRole = async () => {
            throw new Error('Grant failed');
        };
        db.run(sql`CREATE TEMP TRIGGER fail_refund BEFORE UPDATE OF points ON users
            WHEN NEW.points > OLD.points BEGIN SELECT RAISE(FAIL, 'refund unavailable'); END`);
        const purchase = f.service.reserve(f.input)!;
        expect(await f.service.deliver(purchase, f.roles)).toBe('pending');
        expect(f.balance()).toBe(70);
        db.run(sql`DROP TRIGGER fail_refund`);
        const restarted = new PurchaseService();
        await restarted.recover(f.roles);
        await restarted.recover(f.roles);
        expect(f.balance()).toBe(100);
        expect(f.inventory()).toHaveLength(0);
    });

    test('a crash after debit but before grant is refunded on recovery', async () => {
        const f = fixture();
        f.service.reserve(f.input);
        await new PurchaseService().recover(f.roles);
        expect(f.balance()).toBe(100);
        expect(f.owned()).toBe(false);
    });

    test('recovery does not interfere with a live grant in this process', async () => {
        const f = fixture();
        let release!: () => void;
        const wait = new Promise<void>((resolve) => {
            release = resolve;
        });
        const add = f.roles.addRole;
        f.roles.addRole = async (p) => {
            await wait;
            await add(p);
        };
        const delivery = f.service.deliver(f.service.reserve(f.input)!, f.roles);
        await f.service.recover(f.roles);
        expect(f.balance()).toBe(70);
        release();
        expect(await delivery).toBe('completed');
    });

    test('non-role purchases atomically complete inventory and debit', async () => {
        const f = fixture();
        expect(
            await f.service.deliver(
                f.service.reserve({ ...f.input, roleId: undefined, consumable: true })!,
                f.roles,
            ),
        ).toBe('completed');
        expect(f.balance()).toBe(70);
        expect(f.inventory()).toHaveLength(1);
        expect(f.owned()).toBe(false);
    });
});
