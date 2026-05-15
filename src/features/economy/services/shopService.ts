import db from '../../../database/db.js';
import { shopItems, userInventory } from '../../../database/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import economyService from './economyService.js';
import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { shopCatalog, type ShopItemConfig } from '../shopConfig.js';
import logger from '../../../utils/logger.js';

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
        interaction: ChatInputCommandInteraction,
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
            logger.info('Shop purchase rejected because item is already owned', purchaseMetadata);
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
            const member = interaction.member as any;

            if (!member || !interaction.guild) {
                logger.warn('Shop role purchase failed outside a guild context', purchaseMetadata);
                return {
                    success: false,
                    message: 'Error al asignar el rol. ¿Estás en el servidor?',
                };
            }

            try {
                // Check if Role ID is the placeholder
                if (roleId.startsWith('REPLACE') || roleId.includes('_HERE')) {
                    logger.error('Shop role purchase failed because role ID is not configured', {
                        ...purchaseMetadata,
                        roleId,
                    });
                    return {
                        success: false,
                        message:
                            '⚠️ Error: El ID del rol no está configurado en `config/bot.config.json`.',
                    };
                }

                const role = interaction.guild.roles.cache.get(roleId);

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
                        message: 'Error de configuración: El rol no existe en Discord.',
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

                const botMember =
                    interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
                if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || !role.editable) {
                    logger.warn('Shop role purchase cannot assign role due to bot permissions', {
                        ...purchaseMetadata,
                        roleId,
                        roleName: role.name,
                        botHasManageRoles: botMember.permissions.has(
                            PermissionFlagsBits.ManageRoles,
                        ),
                        roleEditable: role.editable,
                        botHighestRole: botMember.roles.highest.name,
                    });
                }

                await member.roles.add(role);
            } catch (error) {
                if (paid) {
                    await economyService.addBalance(userId, item.price);
                }
                logger.error('Shop role purchase failed during role assignment', {
                    ...purchaseMetadata,
                    roleId,
                    refunded: paid,
                    error,
                });
                return {
                    success: false,
                    message:
                        'No pude asignar el rol. Se ha reembolsado la compra. Verifica mis permisos (Gestión de Roles).',
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
                message: 'No pude guardar la compra. Se ha reembolsado el importe.',
            };
        }

        logger.info('Shop purchase completed', purchaseMetadata);
        return { success: true, message: `¡Has comprado **${item.name}** por ${item.price} ₧!` };
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
