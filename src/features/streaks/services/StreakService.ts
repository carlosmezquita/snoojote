import { type Message, type TextChannel } from 'discord.js';
import { asc, desc, eq } from 'drizzle-orm';
import db from '../../../database/db.js';
import { shopItems, streaks, userInventory } from '../../../database/schema.js';
import { config } from '../../../config.js';
import { type DiscordBot } from '../../../core/client.js';
import economyService from '../../economy/services/economyService.js';
import {
    getNewMilestones,
    getSpainDateKey,
    isConsecutiveDay,
    isWithinGracePeriod,
    MILESTONE_BONUSES,
} from './streakRules.js';

const BOT_CHANNEL_ID = config.channels.bot;
const STREAK_FREEZE_VALUE = 'STREAK_FREEZE';

type StreakRecord = typeof streaks.$inferSelect;

export class StreakService {
    async handleStreak(message: Message, client: DiscordBot) {
        const userId = message.author.id;
        const now = new Date();
        const todayKey = getSpainDateKey(now);

        try {
            const userStreak = await this.getUserStreak(userId);

            if (userStreak) {
                await this.updateExistingStreak(message, userStreak, todayKey, now, client);
            } else {
                await this.createNewStreak(message, todayKey, now, client);
            }
        } catch (error) {
            client.logger.error(`Error handling streak for ${userId}: ${error}`);
        }
    }

    private async updateExistingStreak(
        message: Message,
        userStreak: StreakRecord,
        todayKey: string,
        now: Date,
        client: DiscordBot,
    ) {
        if (userStreak.lastStreakDate === todayKey) {
            return;
        }

        const claimedMilestones = this.parseClaimedMilestones(userStreak.claimedMilestones);
        const lastStreakDate = userStreak.lastStreakDate;
        const lastStreakAt =
            userStreak.lastStreakAt ?? this.dateFromLegacyValue(userStreak.lastStreakDate);

        const isConsecutive = isConsecutiveDay(lastStreakDate, todayKey);
        const maintainedByGrace = isWithinGracePeriod(lastStreakAt, now);

        let usedFreeze = false;
        let newStreak = 1;

        if (isConsecutive || maintainedByGrace) {
            newStreak = userStreak.streak + 1;
        } else if (await this.consumeStreakFreeze(message.author.id)) {
            usedFreeze = true;
            newStreak = userStreak.streak + 1;
        }

        const currentHighest = userStreak.highestStreak || 0;
        const highestStreak = Math.max(newStreak, currentHighest);
        const newMilestones = getNewMilestones(newStreak, claimedMilestones);
        const updatedClaimedMilestones = [...claimedMilestones, ...newMilestones];

        await db
            .update(streaks)
            .set({
                streak: newStreak,
                highestStreak,
                lastStreakDate: todayKey,
                lastStreakAt: now,
                claimedMilestones: updatedClaimedMilestones,
            })
            .where(eq(streaks.userId, message.author.id));

        for (const milestone of newMilestones) {
            await economyService.addBalance(message.author.id, MILESTONE_BONUSES[milestone]);
        }

        await message.react('🔥');
        await this.sendBotMessage(
            client,
            this.buildStreakMessage(message, newStreak, usedFreeze, newMilestones),
        );
    }

    private async createNewStreak(
        message: Message,
        todayKey: string,
        now: Date,
        client: DiscordBot,
    ) {
        const newMilestones = getNewMilestones(1, []);

        await db.insert(streaks).values({
            userId: message.author.id,
            streak: 1,
            highestStreak: 1,
            lastStreakDate: todayKey,
            lastStreakAt: now,
            claimedMilestones: newMilestones,
        });

        await message.react('🔥');
        await this.sendBotMessage(
            client,
            `¡Hola ${message.author.toString()}!\n\nHas empezado tu primera racha. Ahora cualquier mensaje significativo en canales generales cuenta como check-in diario.`,
        );
    }

    private buildStreakMessage(
        message: Message,
        streak: number,
        usedFreeze: boolean,
        newMilestones: number[],
    ) {
        const lines = [`La racha actual de ${message.author.toString()} es de ${streak} días.`];

        if (usedFreeze) {
            lines.push('🧊 Se consumió un Seguro de Racha para protegerla.');
        }

        for (const milestone of newMilestones) {
            lines.push(`🎁 Hito de ${milestone} días: +${MILESTONE_BONUSES[milestone]} ₧.`);
        }

        return lines.join('\n');
    }

    private async consumeStreakFreeze(userId: string): Promise<boolean> {
        const freezeItem = await db
            .select()
            .from(shopItems)
            .where(eq(shopItems.value, STREAK_FREEZE_VALUE))
            .get();

        if (!freezeItem) return false;

        const inventorySlots = await db
            .select()
            .from(userInventory)
            .where(eq(userInventory.userId, userId))
            .orderBy(asc(userInventory.acquiredAt))
            .all();
        const inventorySlot = inventorySlots.find((slot) => slot.itemId === freezeItem.id);

        if (!inventorySlot) return false;

        await db.delete(userInventory).where(eq(userInventory.id, inventorySlot.id));

        return true;
    }

    private async sendBotMessage(client: DiscordBot, content: string) {
        const botChannel = client.channels.cache.get(BOT_CHANNEL_ID) as TextChannel;
        if (botChannel) {
            await botChannel.send({ content });
        }
    }

    async getUserStreak(userId: string) {
        return await db.select().from(streaks).where(eq(streaks.userId, userId)).get();
    }

    async getTopStreaks(limit: number = 10) {
        return await db
            .select()
            .from(streaks)
            .orderBy(desc(streaks.highestStreak))
            .limit(limit)
            .all();
    }

    async getStreakFreezeCount(userId: string): Promise<number> {
        const freezeItem = await db
            .select()
            .from(shopItems)
            .where(eq(shopItems.value, STREAK_FREEZE_VALUE))
            .get();

        if (!freezeItem) return 0;

        const inventorySlots = await db
            .select()
            .from(userInventory)
            .where(eq(userInventory.userId, userId))
            .all();

        return inventorySlots.filter((slot) => slot.itemId === freezeItem.id).length;
    }

    private parseClaimedMilestones(value: unknown): number[] {
        if (Array.isArray(value)) {
            return value.filter((item): item is number => typeof item === 'number');
        }
        return [];
    }

    private dateFromLegacyValue(value: string | null): Date | null {
        if (!value) return null;

        const unixSeconds = Number(value);
        if (!Number.isNaN(unixSeconds)) {
            return new Date(unixSeconds * 1000);
        }

        const parsed = new Date(`${value}T00:00:00+01:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
}

export default new StreakService();
