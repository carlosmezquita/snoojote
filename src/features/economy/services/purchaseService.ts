import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import db, { type AppDatabase } from '../../../database/db.js';
import { shopPurchases, userInventory, users } from '../../../database/schema.js';
import logger from '../../../utils/logger.js';

export type Purchase = typeof shopPurchases.$inferSelect;
export interface RoleDelivery {
    hasRole(this: void, purchase: Purchase): Promise<boolean>;
    addRole(this: void, purchase: Purchase): Promise<void>;
    removeRole(this: void, purchase: Purchase): Promise<void>;
}

export class PurchaseService {
    private readonly inFlight = new Set<string>();
    constructor(private readonly database: AppDatabase = db) {}

    reserve(input: {
        userId: string;
        guildId: string;
        itemId: number;
        price: number;
        roleId?: string;
        roleWasOwned?: boolean;
        consumable: boolean;
    }): Purchase | null {
        if (!Number.isSafeInteger(input.price) || input.price <= 0)
            throw new Error('Invalid price');
        return this.database.transaction((tx) => {
            if (
                tx
                    .select()
                    .from(shopPurchases)
                    .where(
                        and(
                            eq(shopPurchases.userId, input.userId),
                            eq(shopPurchases.status, 'pending'),
                        ),
                    )
                    .get()
            )
                return null;
            if (
                !input.consumable &&
                tx
                    .select()
                    .from(userInventory)
                    .where(
                        and(
                            eq(userInventory.userId, input.userId),
                            eq(userInventory.itemId, input.itemId),
                        ),
                    )
                    .get()
            )
                return null;
            const debit = tx
                .update(users)
                .set({ points: sql`${users.points} - ${input.price}` })
                .where(and(eq(users.userId, input.userId), sql`${users.points} >= ${input.price}`))
                .returning()
                .get();
            if (!debit) return null;
            return tx
                .insert(shopPurchases)
                .values({
                    id: randomUUID(),
                    userId: input.userId,
                    guildId: input.guildId,
                    itemId: input.itemId,
                    price: input.price,
                    roleId: input.roleId,
                    roleWasOwned: input.roleWasOwned ?? false,
                })
                .returning()
                .get();
        });
    }

    pending(): Purchase[] {
        return this.database
            .select()
            .from(shopPurchases)
            .where(eq(shopPurchases.status, 'pending'))
            .all();
    }

    async deliver(purchase: Purchase, roles: RoleDelivery): Promise<Purchase['status']> {
        return this.run(purchase, roles, false);
    }

    async recover(roles: RoleDelivery): Promise<void> {
        for (const purchase of this.pending()) await this.run(purchase, roles, true);
    }

    private async run(purchase: Purchase, roles: RoleDelivery, recovering: boolean) {
        if (this.inFlight.has(purchase.id)) return 'pending' as const;
        this.inFlight.add(purchase.id);
        try {
            if (this.current(purchase.id)?.status !== 'pending') {
                return this.current(purchase.id)!.status;
            }
            if (recovering && purchase.roleId && !(await roles.hasRole(purchase))) {
                // A crash before delivery: release the debit without granting a new role.
                this.refund(purchase);
                return 'refunded' as const;
            }
            if (!recovering && purchase.roleId && !purchase.roleWasOwned) {
                await roles.addRole(purchase);
            }
            this.complete(purchase);
            return 'completed' as const;
        } catch (error) {
            logger.error('Purchase delivery failed; attempting compensation', {
                purchaseId: purchase.id,
                error,
            });
            try {
                // Discord may have accepted a request even when the caller saw an error.
                if (purchase.roleId && !purchase.roleWasOwned && (await roles.hasRole(purchase))) {
                    await roles.removeRole(purchase);
                    if (await roles.hasRole(purchase))
                        throw new Error('Role removal was not confirmed', { cause: error });
                }
                this.refund(purchase);
                return 'refunded' as const;
            } catch (recoveryError) {
                // Keep the debit and journal together. Never announce an unconfirmed refund.
                logger.error('Purchase remains pending recovery', {
                    purchaseId: purchase.id,
                    error: recoveryError,
                });
                try {
                    this.database
                        .update(shopPurchases)
                        .set({ lastError: String(recoveryError) })
                        .where(eq(shopPurchases.id, purchase.id))
                        .run();
                } catch (writeError) {
                    logger.error('Could not persist purchase recovery error', {
                        purchaseId: purchase.id,
                        error: writeError,
                    });
                }
                return 'pending' as const;
            }
        } finally {
            this.inFlight.delete(purchase.id);
        }
    }

    private current(id: string) {
        return this.database.select().from(shopPurchases).where(eq(shopPurchases.id, id)).get();
    }

    private complete(purchase: Purchase) {
        this.database.transaction((tx) => {
            const updated = tx
                .update(shopPurchases)
                .set({ status: 'completed', lastError: null })
                .where(and(eq(shopPurchases.id, purchase.id), eq(shopPurchases.status, 'pending')))
                .returning()
                .get();
            if (!updated) return;
            tx.insert(userInventory)
                .values({ userId: purchase.userId, itemId: purchase.itemId })
                .run();
        });
    }

    private refund(purchase: Purchase) {
        this.database.transaction((tx) => {
            const updated = tx
                .update(shopPurchases)
                .set({ status: 'refunded', lastError: null })
                .where(and(eq(shopPurchases.id, purchase.id), eq(shopPurchases.status, 'pending')))
                .returning()
                .get();
            if (!updated) return;
            const credited = tx
                .update(users)
                .set({ points: sql`${users.points} + ${purchase.price}` })
                .where(eq(users.userId, purchase.userId))
                .returning()
                .get();
            if (!credited) throw new Error('Refund account is missing');
        });
    }
}

export default new PurchaseService();
