import { Guild } from 'discord.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { desc, isNotNull, eq, and, sql, count, isNull } from 'drizzle-orm';
import { config } from '../../../config.js';
import NodeCache from 'node-cache';

export class ResponseTimeService {
    private cache: NodeCache;

    constructor() {
        // Cache for 5 minutes (300 seconds)
        this.cache = new NodeCache({ stdTTL: 300 });
    }

    /**
     * Records the time of the first response to a ticket by a staff member.
     */
    async recordResponse(ticketId: number, timestamp: Date): Promise<void> {
        const ticket = await db.select().from(tickets).where(eq(tickets.id, ticketId)).get();

        if (ticket && !ticket.firstResponseAt) {
            await db.update(tickets)
                .set({ firstResponseAt: timestamp })
                .where(eq(tickets.id, ticketId));
        }
    }

    /**
     * Calculates the estimated wait time for a new ticket using Hybrid Empirical-Load Algorithm.
     */
    async getEstimatedWaitTime(guild: Guild): Promise<string> {
        // Step 2.1: Calculate M_recent (Recent Median) & Alpha
        const { median: M_recent, alpha } = await this.getRecentMedian();

        // Step 2.2: Calculate H_dh (Historical Baseline)
        const H_dh = await this.getHistoricalBaseline();

        // Step 2.3: Calculate Q (Queue Length)
        const Q = await this.getQueueLength();

        // Step 2.4: Calculate S (Active Staff)
        const S = await this.getActiveStaff(guild);

        // Step 2.5: Apply Formula
        // BASE_TIME = (alpha * M_recent) + ((1 - alpha) * H_dh)
        let BASE_TIME = (alpha * M_recent) + ((1 - alpha) * H_dh);

        // Edge Case: Zero Data
        if (BASE_TIME === 0) {
             // Hardcode fallback: 15 minutes in ms
             BASE_TIME = 15 * 60 * 1000;
        }

        const EPSILON = 0.25;
        const activeStaffCapped = Math.max(S, EPSILON);
        const loadFactor = (Q + 1) / activeStaffCapped;

        const estimatedWaitTimeMs = BASE_TIME * loadFactor;

        // Step 3: Edge Cases & Safety Bounds
        return this.formatDuration(estimatedWaitTimeMs);
    }

    private formatDuration(ms: number): string {
        // Clamp output
        const oneMinute = 60 * 1000;
        const twentyFourHours = 24 * 60 * 60 * 1000;

        if (ms < oneMinute) {
            return "approx. 1 minute";
        }
        if (ms > twentyFourHours) {
            return "approx. 24+ hours";
        }

        const minutes = Math.ceil(ms / (1000 * 60));
        if (minutes < 60) {
            return `approx. ${minutes} minute${minutes !== 1 ? 's' : ''}`;
        }

        const hours = Math.floor(minutes / 60); // Use floor for hours, then maybe remainder minutes or just hours?
        // Prompt example: "approx. 2 hours". Let's stick to rounding.
        // Actually, let's provide cleaner output like "approx. 1 hour 30 minutes" or just rounded hours if > 1h?
        // Requirement says: "approx. 12 minutes", "approx. 2 hours". Let's keep it simple.

        const roundedHours = Math.round(minutes / 60);
        if (roundedHours === 0) return "approx. 1 hour"; // Edge case where minutes might be 50-59 rounded up?
        // Wait, if minutes < 60 handled above. So minutes >= 60.

        return `approx. ${roundedHours} hour${roundedHours !== 1 ? 's' : ''}`;
    }

    /**
     * Calculates the recent median response time (M_recent) and alpha.
     */
    private async getRecentMedian(): Promise<{ median: number, alpha: number }> {
        const recentTickets = await db.select({
            createdAt: tickets.createdAt,
            firstResponseAt: tickets.firstResponseAt
        })
            .from(tickets)
            .where(isNotNull(tickets.firstResponseAt))
            .orderBy(desc(tickets.createdAt))
            .limit(10)
            .all();

        if (recentTickets.length === 0) {
            return { median: 0, alpha: 0.6 };
        }

        const diffs = recentTickets.map(t => {
            if (t.firstResponseAt && t.createdAt) {
                return t.firstResponseAt.getTime() - t.createdAt.getTime();
            }
            return 0;
        }).filter(d => d > 0).sort((a, b) => a - b);

        if (diffs.length === 0) return { median: 0, alpha: 0.6 };

        const mid = Math.floor(diffs.length / 2);
        const median = diffs.length % 2 !== 0 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;

        const mostRecent = recentTickets[0];
        const now = new Date();
        const oneDayMs = 24 * 60 * 60 * 1000;

        let alpha = 0.6;
        if (mostRecent.createdAt) {
            const timeSinceCreation = now.getTime() - mostRecent.createdAt.getTime();
            if (timeSinceCreation > oneDayMs) {
                alpha = 0.2;
            }
        }

        return { median, alpha };
    }

    /**
     * Calculates the historical baseline (H_dh) for the current day/block.
     */
    private async getHistoricalBaseline(): Promise<number> {
        const now = new Date();
        const currentDayOfWeek = now.getDay(); // 0-6
        const currentHour = now.getHours();
        const currentBlock = Math.floor(currentHour / 4); // 0-5

        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        const history = await db.select({
            createdAt: tickets.createdAt,
            firstResponseAt: tickets.firstResponseAt
        })
        .from(tickets)
        .where(and(
            isNotNull(tickets.firstResponseAt),
            sql`created_at >= ${sixtyDaysAgo}`,
            sql`CAST(strftime('%w', created_at / 1000, 'unixepoch') AS INTEGER) = ${currentDayOfWeek}`,
            sql`CAST(strftime('%H', created_at / 1000, 'unixepoch') AS INTEGER) / 4 = ${currentBlock}`
        ))
        .all();

        if (history.length < 5) {
             const allHistory = await db.select({
                createdAt: tickets.createdAt,
                firstResponseAt: tickets.firstResponseAt
            })
            .from(tickets)
            .where(isNotNull(tickets.firstResponseAt))
            .limit(100)
            .orderBy(desc(tickets.createdAt))
            .all();

            return this.calculateMedian(allHistory);
        }

        return this.calculateMedian(history);
    }

    private calculateMedian(dataset: { createdAt: Date, firstResponseAt: Date | null }[]): number {
        if (dataset.length === 0) return 0;

        const diffs = dataset.map(t => {
            if (t.firstResponseAt && t.createdAt) {
                return t.firstResponseAt.getTime() - t.createdAt.getTime();
            }
            return 0;
        }).filter(d => d > 0).sort((a, b) => a - b);

        if (diffs.length === 0) return 0;

        const mid = Math.floor(diffs.length / 2);
        return diffs.length % 2 !== 0 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
    }

    /**
     * Calculates Queue Length (Q).
     */
    private async getQueueLength(): Promise<number> {
        const result = await db.select({ count: count() })
            .from(tickets)
            .where(and(eq(tickets.status, 'open'), isNull(tickets.firstResponseAt)))
            .get();
        return result?.count ?? 0;
    }

    /**
     * Calculates Active Staff (S) safely with caching.
     */
    private async getActiveStaff(guild: Guild): Promise<number> {
        const cacheKey = `active_staff_${guild.id}`;
        const cachedStaff = this.cache.get<number>(cacheKey);

        if (cachedStaff !== undefined) {
            return cachedStaff;
        }

        const supportRoleId = config.roles.support;
        if (!supportRoleId) return 0;

        try {
            await guild.members.fetch();

            const supportRole = guild.roles.cache.get(supportRoleId);
            if (!supportRole) return 0;

            const activeStaffCount = supportRole.members.filter(member => {
                const status = member.presence?.status;
                return status === 'online' || status === 'dnd' || status === 'idle';
            }).size;

            this.cache.set(cacheKey, activeStaffCount);
            return activeStaffCount;

        } catch (error) {
            console.error("Error fetching members for staff count:", error);
            return 0;
        }
    }
}

export default new ResponseTimeService();
