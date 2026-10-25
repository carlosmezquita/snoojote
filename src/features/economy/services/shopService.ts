import db from '../../../database/db.js';
import { shopItems, userInventory } from '../../../database/schema.js';
import { eq, and, asc, getTableColumns } from 'drizzle-orm';
import economyService from './economyService.js';
import {
    type ButtonInteraction,
    PermissionFlagsBits,
    type ChatInputCommandInteraction,
} from 'discord.js';
import purchaseService, { type RoleDelivery } from './purchaseService.js';
import { type Client } from 'discord.js';
import { shopCatalog, type ShopItemConfig } from '../shopConfig.js';
import logger from '../../../utils/logger.js';
import { isSafeSelfAssignableRole } from '../../../shared/utils/roles.js';

type ShopInteraction = ChatInputCommandInteraction | ButtonInteraction;

const GENERIC_PURCHASE_ERROR = 'No pude completar la compra. No se ha cobrado el importe.';

export class ShopService {
    private seeded = false;
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
        return db
            .select({ ...getTableColumns(shopItems), acquiredAt: userInventory.acquiredAt })
            .from(userInventory)
            .innerJoin(shopItems, eq(shopItems.id, userInventory.itemId))
            .where(eq(userInventory.userId, userId))
            .all();
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

        let roleWasOwned = false;
        if (item.type === 'ROLE') {
            if (!interaction.guild) return { success: false, message: GENERIC_PURCHASE_ERROR };
            try {
                const role = await interaction.guild.roles.fetch(item.value);
                const [bot, member] = await Promise.all([
                    interaction.guild.members.fetchMe({ force: true }),
                    interaction.guild.members.fetch({ user: userId, force: true }),
                ]);
                if (
                    !role ||
                    !isSafeSelfAssignableRole(role) ||
                    !bot.permissions.has(PermissionFlagsBits.ManageRoles) ||
                    role.comparePositionTo(bot.roles.highest) >= 0
                ) {
                    return { success: false, message: GENERIC_PURCHASE_ERROR };
                }
                roleWasOwned = member.roles.cache.has(role.id);
            } catch (error) {
                logger.error('Shop role validation failed', { ...purchaseMetadata, error });
                return { success: false, message: GENERIC_PURCHASE_ERROR };
            }
        }

        const purchase = purchaseService.reserve({
            userId,
            guildId,
            itemId: item.id,
            price: item.price,
            roleId: item.type === 'ROLE' ? item.value : undefined,
            roleWasOwned,
            consumable: isConsumable,
        });
        if (!purchase)
            return {
                success: false,
                message:
                    'Compra no disponible: revisa tu saldo, inventario o una compra pendiente.',
            };
        const status = await purchaseService.deliver(
            purchase,
            discordRoleDelivery(interaction.client),
        );
        if (status !== 'completed')
            return {
                success: false,
                message:
                    status === 'refunded'
                        ? 'No pude completar la compra. El importe se ha reembolsado.'
                        : 'La compra está pendiente de revisión. No vuelvas a comprar; contacta con el equipo.',
            };

        logger.info('Shop purchase completed', purchaseMetadata);
        return {
            success: true,
            message: `¡Has comprado **${item.name}** por ${item.price} ₧!`,
        };
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
        if (this.seeded) return;
        db.transaction(
            (tx) => {
                const existing = tx.select().from(shopItems).all();
                const byName = new Map(existing.map((item) => [item.name, item]));
                const names = new Set(shopCatalog.map((item) => item.name));
                for (const item of existing)
                    if (!names.has(item.name))
                        tx.delete(shopItems).where(eq(shopItems.id, item.id)).run();
                for (const item of shopCatalog) {
                    const current = byName.get(item.name);
                    if (current)
                        tx.update(shopItems).set(item).where(eq(shopItems.id, current.id)).run();
                    else tx.insert(shopItems).values(item).run();
                }
            },
            { behavior: 'immediate' },
        );
        this.seeded = true;
    }
}

export function discordRoleDelivery(client: Client): RoleDelivery {
    const memberFor = async (purchase: Parameters<RoleDelivery['hasRole']>[0]) => {
        const guild = await client.guilds.fetch(purchase.guildId);
        return guild.members.fetch({ user: purchase.userId, force: true });
    };
    return {
        hasRole: async (purchase) => (await memberFor(purchase)).roles.cache.has(purchase.roleId!),
        addRole: async (purchase) => {
            await (await memberFor(purchase)).roles.add(purchase.roleId!, 'Shop purchase');
        },
        removeRole: async (purchase) => {
            await (
                await memberFor(purchase)
            ).roles.remove(purchase.roleId!, 'Shop purchase rollback');
        },
    };
}

export default new ShopService();
