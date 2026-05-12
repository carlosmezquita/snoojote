import { type Guild } from 'discord.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { desc, isNotNull, eq, and, isNull, count, gte } from 'drizzle-orm';
import { config } from '../../../config.js';
import {
    type TicketResponseData,
    getTimeBlock,
    estimateWaitTimeMs,
    formatDuration,
} from './waitTimeEstimator.js';

// ---------------------------------------------------------------------------
// In-memory cache for guild.members.fetch() — 5-minute TTL
// ---------------------------------------------------------------------------

interface StaffCacheEntry {
    activeCount: number;
    fetchedAt: number;
}

const STAFF_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const staffCache = new Map<string, StaffCacheEntry>();
const ESTIMATION_TIME_ZONE = 'Europe/Madrid';

export class ResponseTimeService {
    /**
     * Records the time of the first response to a ticket by a staff member.
     * Only updates if firstResponseAt is currently null.
     */
    async recordResponse(ticketId: number, timestamp: Date): Promise<void> {
        const ticket = await db.select().from(tickets).where(eq(tickets.id, ticketId)).get();

        if (ticket && !ticket.firstResponseAt) {
            await db
                .update(tickets)
                .set({ firstResponseAt: timestamp })
                .where(eq(tickets.id, ticketId));
        }
    }

    /**
     * Fetches and counts active staff members (online, dnd, or idle)
     * using guild.members.fetch() with a 5-minute in-memory cache to
     * avoid Discord API rate-limits.
     */
    async getActiveStaffCount(guild: Guild): Promise<number> {
        const cacheKey = guild.id;
        const cached = staffCache.get(cacheKey);

        if (cached && Date.now() - cached.fetchedAt < STAFF_CACHE_TTL_MS) {
            return cached.activeCount;
        }

        const supportRoleId = config.roles.support;
        if (!supportRoleId) return 0;

        let fetchedMembers = false;
        try {
            // Requires the GuildPresences intent to avoid undercounting active staff.
            await guild.members.fetch({ withPresences: true });
            fetchedMembers = true;
        } catch {
            if (cached) {
                return cached.activeCount;
            }
        }

        const supportRole = guild.roles.cache.get(supportRoleId);
        if (!supportRole) return 0;

        if (!fetchedMembers) {
            return 0;
        }

        const activeCount = supportRole.members.filter((member) => {
            const status = member.presence?.status ?? guild.presences.cache.get(member.id)?.status;
            return status === 'online' || status === 'dnd' || status === 'idle';
        }).size;

        staffCache.set(cacheKey, { activeCount, fetchedAt: Date.now() });
        return activeCount;
    }

    /**
     * Counts the number of currently open tickets that have NOT yet
     * received a staff response. This is the unanswered queue (Q).
     */
    async getUnansweredQueueLength(): Promise<number> {
        const result = await db
            .select({ value: count() })
            .from(tickets)
            .where(and(eq(tickets.status, 'open'), isNull(tickets.firstResponseAt)))
            .get();

        return result?.value ?? 0;
    }

    /**
     * Counts the number of currently open tickets (all, regardless of response).
     * Used for recording context data at ticket creation.
     */
    async getOpenTicketCount(): Promise<number> {
        const result = await db
            .select({ value: count() })
            .from(tickets)
            .where(eq(tickets.status, 'open'))
            .get();

        return result?.value ?? 0;
    }

    /**
     * Calculates the estimated wait time for a new ticket using the
     * Hybrid Empirical-Load Algorithm.
     *
     * Formula: W_est = (α · M_recent + (1 − α) · H_{d,h}) × L(Q, S)
     *
     * Considers: recent median, day-of-week + 4-hour time block seasonality,
     * recency of data, queue depth (Little's Law), and active staff count.
     */
    async getEstimatedWaitTime(guild: Guild): Promise<string> {
        const now = new Date();

        // Step 2.1: M_recent — last 10 answered tickets
        const recentRows = await db
            .select({
                createdAt: tickets.createdAt,
                firstResponseAt: tickets.firstResponseAt,
            })
            .from(tickets)
            .where(isNotNull(tickets.firstResponseAt))
            .orderBy(desc(tickets.createdAt))
            .limit(10)
            .all();

        const recentTickets: TicketResponseData[] = recentRows
            .filter((r) => r.firstResponseAt != null)
            .map((r) => ({
                createdAt: r.createdAt,
                firstResponseAt: r.firstResponseAt!,
            }));

        // Step 2.2: H_{d,h} — temporal baseline (same day-of-week + 4-hour block, last 60 days)
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        const currentParts = getTimeZoneParts(now);
        const currentDay = currentParts.weekday;
        const currentBlock = getTimeBlock(currentParts.hour);

        // Fetch all answered tickets from the last 60 days for temporal filtering
        const historicalRows = await db
            .select({
                createdAt: tickets.createdAt,
                firstResponseAt: tickets.firstResponseAt,
            })
            .from(tickets)
            .where(
                and(isNotNull(tickets.firstResponseAt), gte(tickets.firstResponseAt, sixtyDaysAgo)),
            )
            .all();

        // Filter in-app for matching day-of-week + time block
        // (SQLite timestamp mode makes SQL-level day/hour extraction impractical)
        const temporalTickets: TicketResponseData[] = historicalRows
            .filter((r) => {
                if (!r.firstResponseAt) return false;
                const parts = getTimeZoneParts(r.createdAt);
                return parts.weekday === currentDay && getTimeBlock(parts.hour) === currentBlock;
            })
            .map((r) => ({
                createdAt: r.createdAt,
                firstResponseAt: r.firstResponseAt!,
            }));

        // All answered tickets (for global median fallback)
        const allTickets: TicketResponseData[] = historicalRows
            .filter((r) => r.firstResponseAt != null)
            .map((r) => ({
                createdAt: r.createdAt,
                firstResponseAt: r.firstResponseAt!,
            }));

        // Step 2.3: Q — unanswered queue length
        const queueLength = await this.getUnansweredQueueLength();

        // Step 2.4: S — active staff (with 5-minute fetch cache)
        const activeStaff = await this.getActiveStaffCount(guild);

        // Step 2.5: Apply the formula
        const estimatedMs = estimateWaitTimeMs({
            recentTickets,
            temporalTickets,
            allTickets,
            now,
            queueLength,
            activeStaff,
        });

        return formatDuration(estimatedMs);
    }
}

export default new ResponseTimeService();

function getTimeZoneParts(date: Date): { weekday: number; hour: number } {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: ESTIMATION_TIME_ZONE,
        weekday: 'short',
        hour: '2-digit',
        hourCycle: 'h23',
    });

    const parts = Object.fromEntries(
        formatter
            .formatToParts(date)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]),
    ) as { weekday: string; hour: string };

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return {
        weekday: weekdays.indexOf(parts.weekday),
        hour: Number(parts.hour),
    };
}
