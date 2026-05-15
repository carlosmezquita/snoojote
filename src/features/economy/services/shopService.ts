import db from '../../../database/db.js';
import { shopItems, shopPurchaseLocks, userInventory } from '../../../database/schema.js';
import { eq, and, asc, sql } from 'drizzle-orm';
import economyService from './economyService.js';
import {
    type ButtonInteraction,
    PermissionFlagsBits,
    type ChatInputCommandInteraction,
} from 'discord.js';
import { RESTJSONErrorCodes } from 'discord-api-types/v10';
import { shopCatalog, type ShopItemConfig } from '../shopConfig.js';
import logger from '../../../utils/logger.js';

type ShopInteraction = ChatInputCommandInteraction | ButtonInteraction;

const PURCHASE_LOCK_TTL_MS = 10 * 60 * 1000;
const GENERIC_PURCHASE_ERROR =
    'No pude completar la compra. Se ha reembolsado el importe si ya se había cobrado.';

export class ShopService {
    async getShopItems() {
        // Updated to sort by price ascending
        return await db.select().from(shopItems).orderBy(asc(shopItems.price));
    }

    async getItem(itemId: number) {
        return await db.select().from(shopItems).where(eq(shopItems.id, itemId)).get();
    }

    async getItemByName(name: string) {
        return await db.select().from(shopItems).where(eq(shopItems.name, name)).get();
    }

    async getInventory(userId: string) {
        const inventory = await db
            .select()
            .from(userInventory)
            .where(eq(userInventory.userId, userId));

        const enrichedInventory = [];
        for (const slot of inventory) {
            const item = await this.getItem(slot.itemId);
            if (item) {
                enrichedInventory.push({ ...item, acquiredAt: slot.acquiredAt });
            }
        }
        return enrichedInventory;
    }

    async buyItem(
        interaction: ShopInteraction,
        itemName: string,
    ): Promise<{ success: boolean; message: string }> {
        const item = await db.select().from(shopItems).where(eq(shopItems.name, itemName)).get();
        const userId = interaction.user.id;
        const guildId = interaction.guildId ?? 'unknown';

        if (!item) {
            logger.warn('Shop purchase failed because item was not found', {
                userId,
                guildId,
                requestedItemName: itemName,
            });
            return { success: false, message: 'El artículo no existe.' };
        }

        const isConsumable = item.type === 'CONSUMABLE';
        const catalogItem = this.getCatalogItem(item.name);
        const purchaseMetadata = {
            userId,
            guildId,
            itemId: item.id,
            itemName: item.name,
            itemType: item.type,
            price: item.price,
        };

        logger.info('Shop purchase requested', purchaseMetadata);

        const purchaseLockKey = this.getPurchaseLockKey(userId);
        const lockAcquired = await this.acquirePurchaseLock(purchaseLockKey, userId, item.id);
        if (!lockAcquired) {
            logger.info('Shop purchase rejected because another purchase is already running', {
                ...purchaseMetadata,
                purchaseLockKey,
            });
            return {
                success: false,
                message: 'Ya hay una compra en proceso. Inténtalo de nuevo en unos segundos.',
            };
        }

        try {
            // Check Balance
            const balance = await economyService.getBalance(userId);
            if (balance < item.price) {
                logger.info('Shop purchase rejected for insufficient balance', {
                    ...purchaseMetadata,
                    balance,
                });
                return {
                    success: false,
                    message: `No tienes suficientes Pesetas. Necesitas **${item.price} ₧**.`,
                };
            }

            // Check if already owns
            const existing = await db
                .select()
                .from(userInventory)
                .where(and(eq(userInventory.userId, userId), eq(userInventory.itemId, item.id)))
                .get();

            if (existing && !isConsumable) {
                logger.info(
                    'Shop purchase rejected because item is already owned',
                    purchaseMetadata,
                );
                return { success: false, message: 'Ya tienes este artículo.' };
            }

            if (item.type === 'ROLE') {
                const progressionResult = await this.validateRankProgression(userId, catalogItem);
                if (!progressionResult.success) {
                    logger.info('Shop purchase rejected by rank progression rules', {
                        ...purchaseMetadata,
                        reason: progressionResult.message,
                    });
                    return progressionResult;
                }
            }

            // Process Role Assignment
            let paid = false;
            if (item.type === 'ROLE') {
                const roleId = item.value;

                if (!interaction.guild) {
                    logger.warn(
                        'Shop role purchase failed outside a guild context',
                        purchaseMetadata,
                    );
                    return {
                        success: false,
                        message: GENERIC_PURCHASE_ERROR,
                    };
                }

                try {
                    // Check if Role ID is the placeholder
                    if (roleId.startsWith('REPLACE') || roleId.includes('_HERE')) {
                        logger.error(
                            'Shop role purchase failed because role ID is not configured',
                            {
                                ...purchaseMetadata,
                                roleId,
                            },
                        );
                        return {
                            success: false,
                            message: GENERIC_PURCHASE_ERROR,
                        };
                    }

                    const role = await interaction.guild.roles.fetch(roleId);

                    if (!role) {
                        logger.error(
                            'Shop role purchase failed because configured role was not found',
                            {
                                ...purchaseMetadata,
                                roleId,
                            },
                        );
                        return {
                            success: false,
                            message: GENERIC_PURCHASE_ERROR,
                        };
                    }

                    const [botMember, member] = await Promise.all([
                        interaction.guild.members.fetchMe({ force: true }),
                        interaction.guild.members.fetch({ user: interaction.user.id, force: true }),
                    ]);
                    const botHasManageRoles = botMember.permissions.has(
                        PermissionFlagsBits.ManageRoles,
                    );
                    const botRoleIsHighEnough = role.comparePositionTo(botMember.roles.highest) < 0;
                    if (
                        !botHasManageRoles ||
                        role.managed ||
                        !botRoleIsHighEnough ||
                        !role.editable
                    ) {
                        logger.error('Shop role purchase failed due to bot permissions', {
                            ...purchaseMetadata,
                            roleId,
                            roleName: role.name,
                            roleManaged: role.managed,
                            rolePosition: role.position,
                            botHasManageRoles,
                            botRoleIsHighEnough,
                            roleEditable: role.editable,
                            botHighestRole: botMember.roles.highest.name,
                            botHighestRolePosition: botMember.roles.highest.position,
                        });

                        return {
                            success: false,
                            message: GENERIC_PURCHASE_ERROR,
                        };
                    }

                    paid = await economyService.spendBalance(userId, item.price);
                    if (!paid) {
                        logger.warn('Shop role purchase payment failed after balance check', {
                            ...purchaseMetadata,
                            balance,
                        });
                        return {
                            success: false,
                            message: `No tienes suficientes Pesetas. Necesitas **${item.price} ₧**.`,
                        };
                    }

                    await member.roles.add(role, `Compra en tienda: ${item.name}`);
                } catch (error) {
                    if (paid) {
                        await economyService.addBalance(userId, item.price);
                    }
                    const discordErrorCode = this.getDiscordErrorCode(error);
                    logger.error('Shop role purchase failed during role assignment', {
                        ...purchaseMetadata,
                        roleId,
                        refunded: paid,
                        discordErrorCode,
                        error,
                    });

                    if (
                        discordErrorCode === RESTJSONErrorCodes.MissingPermissions ||
                        discordErrorCode === RESTJSONErrorCodes.MissingAccess
                    ) {
                        return {
                            success: false,
                            message: GENERIC_PURCHASE_ERROR,
                        };
                    }

                    return {
                        success: false,
                        message: GENERIC_PURCHASE_ERROR,
                    };
                }
            }

            if (!paid) {
                paid = await economyService.spendBalance(userId, item.price);
                if (!paid) {
                    logger.warn('Shop purchase payment failed after balance check', {
                        ...purchaseMetadata,
                        balance,
                    });
                    return {
                        success: false,
                        message: `No tienes suficientes Pesetas. Necesitas **${item.price} ₧**.`,
                    };
                }
            }

            try {
                await db.insert(userInventory).values({
                    userId,
                    itemId: item.id,
                });
            } catch (error) {
                await economyService.addBalance(userId, item.price);
                logger.error('Shop purchase failed while saving inventory item', {
                    ...purchaseMetadata,
                    refunded: true,
                    error,
                });
                return {
                    success: false,
                    message: GENERIC_PURCHASE_ERROR,
                };
            }

            logger.info('Shop purchase completed', purchaseMetadata);
            return {
                success: true,
                message: `¡Has comprado **${item.name}** por ${item.price} ₧!`,
            };
        } finally {
            await this.releasePurchaseLock(purchaseLockKey);
        }
    }

    private getCatalogItem(itemName: string): ShopItemConfig | undefined {
        return shopCatalog.find((item) => item.name === itemName);
    }

    private async validateRankProgression(
        userId: string,
        catalogItem: ShopItemConfig | undefined,
    ): Promise<{ success: boolean; message: string }> {
        if (!catalogItem?.rankOrder || catalogItem.rankOrder <= 1) {
            return { success: true, message: '' };
        }

        const previousRank = shopCatalog.find(
            (candidate) =>
                candidate.type === 'ROLE' && candidate.rankOrder === catalogItem.rankOrder! - 1,
        );

        if (!previousRank) {
            return {
                success: false,
                message: 'Error de configuración: falta el rango anterior requerido.',
            };
        }

        const previousDbItem = await db
            .select()
            .from(shopItems)
            .where(eq(shopItems.name, previousRank.name))
            .get();

        if (!previousDbItem) {
            return {
                success: false,
                message: 'Error de configuración: el rango anterior no existe en la tienda.',
            };
        }

        const existingPreviousRank = await db
            .select()
            .from(userInventory)
            .where(
                and(eq(userInventory.userId, userId), eq(userInventory.itemId, previousDbItem.id)),
            )
            .get();

        if (!existingPreviousRank) {
            return {
                success: false,
                message: `Debes comprar **${previousRank.name}** antes de comprar **${catalogItem.name}**.`,
            };
        }

        return { success: true, message: '' };
    }

    private getDiscordErrorCode(error: unknown): number | undefined {
        if (typeof error !== 'object' || error === null || !('code' in error)) {
            return undefined;
        }

        const code = (error as { code: unknown }).code;
        return typeof code === 'number' ? code : undefined;
    }

    private getPurchaseLockKey(userId: string): string {
        return userId;
    }

    private async acquirePurchaseLock(
        lockKey: string,
        userId: string,
        itemId: number,
    ): Promise<boolean> {
        const staleBefore = new Date(Date.now() - PURCHASE_LOCK_TTL_MS);
        await db
            .delete(shopPurchaseLocks)
            .where(sql`${shopPurchaseLocks.createdAt} < ${staleBefore}`);

        const result = await db
            .insert(shopPurchaseLocks)
            .values({ lockKey, userId, itemId })
            .onConflictDoNothing()
            .returning({ lockKey: shopPurchaseLocks.lockKey })
            .get();

        return Boolean(result);
    }

    private async releasePurchaseLock(lockKey: string): Promise<void> {
        await db.delete(shopPurchaseLocks).where(eq(shopPurchaseLocks.lockKey, lockKey));
    }

    async seedItems() {
        // Sync DB with Config
        const configNames = shopCatalog.map((i) => i.name);

        // 1. Delete items not in config
        const dbItems = await db.select().from(shopItems);
        for (const dbItem of dbItems) {
            if (!configNames.includes(dbItem.name)) {
                await db.delete(shopItems).where(eq(shopItems.id, dbItem.id));
                logger.info('Removed obsolete shop item', {
                    itemId: dbItem.id,
                    itemName: dbItem.name,
                });
            }
        }

        // 2. Upsert items from config
        for (const configItem of shopCatalog) {
            // Check if exists by name
            const existing = await db
                .select()
                .from(shopItems)
                .where(eq(shopItems.name, configItem.name))
                .get();

            if (existing) {
                // Update properties if changed (price, description, value, emoji)
                if (
                    existing.price !== configItem.price ||
                    existing.value !== configItem.value ||
                    existing.emoji !== configItem.emoji
                ) {
                    await db
                        .update(shopItems)
                        .set({
                            description: configItem.description,
                            price: configItem.price,
                            type: configItem.type,
                            value: configItem.value,
                            emoji: configItem.emoji,
                        })
                        .where(eq(shopItems.id, existing.id));
                }
            } else {
                // Insert new
                await db.insert(shopItems).values(configItem);
            }
        }
    }
}

export default new ShopService();
