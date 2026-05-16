import { type Guild } from 'discord.js';
import db from '../../../database/db.js';
import {
    ticketStaffActivity,
    tickets,
    ticketWaitEstimateSnapshots,
} from '../../../database/schema.js';
import { desc, isNotNull, eq, and, isNull, count, gte, inArray } from 'drizzle-orm';
import { config } from '../../../config.js';
import {
    WAIT_ESTIMATOR_MODEL_VERSION,
    type EstimationResult,
    type StaffResponseProfile,
    type StaffStatus,
    type TicketResponseData,
    computePresenceWeight,
    getTimeBlock,
    estimateWaitTime,
    formatDuration,
} from './waitTimeEstimator.js';
import logger from '../../../utils/logger.js';

// ---------------------------------------------------------------------------
// In-memory cache for guild.members.fetch() — 5-minute TTL
// ---------------------------------------------------------------------------

interface StaffCacheEntry {
    activeCount: number;
    weightedCapacity: number;
    statusBreakdown: Record<StaffStatus, number>;
    staffProfiles: StaffResponseProfile[];
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
    async recordResponse(
        ticketId: number,
        staffId: string,
        timestamp: Date,
        messageId?: string,
    ): Promise<void> {
        const ticket = await db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
        if (!ticket) return;

        let responseTimeMs: number | null = null;

        if (!ticket.firstResponseAt) {
            const candidateResponseTimeMs = isFiniteDate(ticket.createdAt)
                ? Math.max(timestamp.getTime() - ticket.createdAt.getTime(), 0)
                : null;

            const updatedTicket = await db
                .update(tickets)
                .set({ firstResponseAt: timestamp, firstResponseBy: staffId })
                .where(and(eq(tickets.id, ticketId), isNull(tickets.firstResponseAt)))
                .returning({ id: tickets.id })
                .get();

            if (updatedTicket) {
                responseTimeMs = candidateResponseTimeMs;
            }
        }

        await db.insert(ticketStaffActivity).values({
            ticketId,
            staffId,
            action: 'message',
            messageId,
            occurredAt: timestamp,
            responseTimeMs,
        });
    }

    /**
     * Fetches and counts active staff members (online, dnd, or idle)
     * using guild.members.fetch() with a 5-minute in-memory cache to
     * avoid Discord API rate-limits.
     */
    async getActiveStaffCount(guild: Guild): Promise<number> {
        return (await this.getStaffCapacity(guild)).activeCount;
    }

    async getWeightedStaffCapacity(guild: Guild): Promise<number> {
        return (await this.getStaffCapacity(guild)).weightedCapacity;
    }

    /**
     * Fetches current support staff status, excluding bots, and converts it to
     * weighted capacity: online 1.0, idle 0.5, dnd 0.25, offline/unknown 0.
     */
    async getStaffCapacity(guild: Guild): Promise<StaffCacheEntry> {
        const cacheKey = guild.id;
        const cached = staffCache.get(cacheKey);

        if (cached && Date.now() - cached.fetchedAt < STAFF_CACHE_TTL_MS) {
            return cached;
        }

        const supportRoleId = config.roles.support;
        if (!supportRoleId) return emptyStaffCapacity();

        let fetchedMembers = false;
        try {
            // Requires the GuildPresences intent to avoid undercounting active staff.
            await guild.members.fetch({ withPresences: true });
            fetchedMembers = true;
        } catch {
            if (cached) {
                return cached;
            }
        }

        const supportRole = guild.roles.cache.get(supportRoleId);
        if (!supportRole) return emptyStaffCapacity();

        if (!fetchedMembers) {
            return emptyStaffCapacity();
        }

        const staffProfiles: StaffResponseProfile[] = [];
        const statusBreakdown = emptyStatusBreakdown();

        for (const member of supportRole.members.values()) {
            if (member.user.bot) continue;

            const status = normalizePresenceStatus(
                member.presence?.status ?? guild.presences.cache.get(member.id)?.status,
            );
            statusBreakdown[status] += 1;
            staffProfiles.push({
                staffId: member.id,
                status,
                isBot: member.user.bot,
            });
        }

        const activeCount = staffProfiles.filter(
            (staff) => computePresenceWeight(staff.status) > 0,
        ).length;
        const weightedCapacity = staffProfiles.reduce(
            (total, staff) => total + computePresenceWeight(staff.status),
            0,
        );

        const entry = {
            activeCount,
            weightedCapacity,
            statusBreakdown,
            staffProfiles,
            fetchedAt: Date.now(),
        };
        staffCache.set(cacheKey, entry);
        return entry;
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
     * Calculates the estimated wait time for a new ticket using the per-staff,
     * capacity-weighted model.
     */
    async getEstimatedWaitTime(guild: Guild): Promise<string> {
        return formatDuration((await this.createEstimate(guild)).estimatedMs);
    }

    async createEstimate(guild: Guild, queueLengthOverride?: number): Promise<EstimationResult> {
        const now = new Date();

        // Recent baseline: last 20 answered tickets.
        const recentRows = await db
            .select({
                createdAt: tickets.createdAt,
                firstResponseAt: tickets.firstResponseAt,
                staffCapacityAtCreation: tickets.staffCapacityAtCreation,
                openTicketsAtCreation: tickets.openTicketsAtCreation,
            })
            .from(tickets)
            .where(isNotNull(tickets.firstResponseAt))
            .orderBy(desc(tickets.createdAt))
            .limit(20)
            .all();

        const recentTickets: TicketResponseData[] = recentRows
            .filter(
                (r) =>
                    isFiniteDate(r.createdAt) &&
                    r.firstResponseAt != null &&
                    isFiniteDate(r.firstResponseAt),
            )
            .map((r) => ({
                createdAt: r.createdAt,
                firstResponseAt: r.firstResponseAt!,
                staffCapacityAtCreation: r.staffCapacityAtCreation,
                openTicketsAtCreation: r.openTicketsAtCreation,
            }));

        // Temporal baseline: same day-of-week + 4-hour block, last 60 days.
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        const currentParts = getTimeZoneParts(now)!;
        const currentDay = currentParts.weekday;
        const currentBlock = getTimeBlock(currentParts.hour);

        const historicalRows = await db
            .select({
                createdAt: tickets.createdAt,
                firstResponseAt: tickets.firstResponseAt,
                staffCapacityAtCreation: tickets.staffCapacityAtCreation,
                openTicketsAtCreation: tickets.openTicketsAtCreation,
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
                if (
                    !isFiniteDate(r.createdAt) ||
                    !r.firstResponseAt ||
                    !isFiniteDate(r.firstResponseAt)
                ) {
                    return false;
                }
                const parts = getTimeZoneParts(r.createdAt);
                if (!parts) return false;
                return parts.weekday === currentDay && getTimeBlock(parts.hour) === currentBlock;
            })
            .map((r) => ({
                createdAt: r.createdAt,
                firstResponseAt: r.firstResponseAt!,
                staffCapacityAtCreation: r.staffCapacityAtCreation,
                openTicketsAtCreation: r.openTicketsAtCreation,
            }));

        const allTickets: TicketResponseData[] = historicalRows
            .filter(
                (r) =>
                    isFiniteDate(r.createdAt) &&
                    r.firstResponseAt != null &&
                    isFiniteDate(r.firstResponseAt),
            )
            .map((r) => ({
                createdAt: r.createdAt,
                firstResponseAt: r.firstResponseAt!,
                staffCapacityAtCreation: r.staffCapacityAtCreation,
                openTicketsAtCreation: r.openTicketsAtCreation,
            }));

        const queueLength = queueLengthOverride ?? (await this.getUnansweredQueueLength());
        const staffCapacity = await this.getStaffCapacity(guild);
        const staffProfiles = await this.enrichStaffProfiles(staffCapacity.staffProfiles, now);

        const estimate = estimateWaitTime({
            recentTickets,
            temporalTickets,
            allTickets,
            staffProfiles,
            now,
            queueLength,
        });

        logger.debug('Ticket wait estimate generated', {
            modelVersion: WAIT_ESTIMATOR_MODEL_VERSION,
            statusBreakdown: staffCapacity.statusBreakdown,
            weightedStaffCapacity: staffCapacity.weightedCapacity,
            activeStaffIncluded: estimate.factors.responderPool.map((entry) => ({
                staffId: entry.staffId,
                status: entry.status,
                weight: entry.weight,
                sampleCount: entry.sampleCount,
                usesStaffBaseline: entry.usesStaffBaseline,
            })),
            globalBaseMs: estimate.factors.globalTemporalBaseMs,
            activeStaffBaseMs: estimate.factors.activeStaffBaseMs,
            loadMultiplier: estimate.factors.loadMultiplier,
            finalEstimateMs: estimate.estimatedMs,
        });

        return estimate;
    }

    async recordEstimateSnapshot(ticketId: number, estimate: EstimationResult): Promise<void> {
        await db.insert(ticketWaitEstimateSnapshots).values({
            ticketId,
            modelVersion: estimate.factors.modelVersion,
            estimatedMs: estimate.estimatedMs,
            factorDetails: estimate.factors,
            createdAt: new Date(),
        });
    }

    async getWaitEstimateDebug(guild: Guild): Promise<{
        estimate: EstimationResult;
        statusBreakdown: Record<StaffStatus, number>;
        weightedStaffCapacity: number;
    }> {
        const staffCapacity = await this.getStaffCapacity(guild);
        return {
            estimate: await this.createEstimate(guild),
            statusBreakdown: staffCapacity.statusBreakdown,
            weightedStaffCapacity: staffCapacity.weightedCapacity,
        };
    }

    private async enrichStaffProfiles(
        staffProfiles: StaffResponseProfile[],
        now: Date,
    ): Promise<StaffResponseProfile[]> {
        if (staffProfiles.length === 0) return [];

        const staffIds = staffProfiles.map((staff) => staff.staffId);
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const firstResponseRows = await db
            .select({
                staffId: ticketStaffActivity.staffId,
                occurredAt: ticketStaffActivity.occurredAt,
                responseTimeMs: ticketStaffActivity.responseTimeMs,
            })
            .from(ticketStaffActivity)
            .where(
                and(
                    inArray(ticketStaffActivity.staffId, staffIds),
                    eq(ticketStaffActivity.action, 'message'),
                    isNotNull(ticketStaffActivity.responseTimeMs),
                    gte(ticketStaffActivity.occurredAt, ninetyDaysAgo),
                ),
            )
            .all();

        const recentActivityRows = await db
            .select({
                staffId: ticketStaffActivity.staffId,
                value: count(),
            })
            .from(ticketStaffActivity)
            .where(
                and(
                    inArray(ticketStaffActivity.staffId, staffIds),
                    eq(ticketStaffActivity.action, 'message'),
                    gte(ticketStaffActivity.occurredAt, sevenDaysAgo),
                ),
            )
            .groupBy(ticketStaffActivity.staffId)
            .all();

        const samplesByStaff = new Map<string, { occurredAt: Date; responseTimeMs: number }[]>();
        for (const row of firstResponseRows) {
            if (
                !isFiniteDate(row.occurredAt) ||
                row.responseTimeMs == null ||
                row.responseTimeMs <= 0
            ) {
                continue;
            }

            const samples = samplesByStaff.get(row.staffId) ?? [];
            samples.push({ occurredAt: row.occurredAt, responseTimeMs: row.responseTimeMs });
            samplesByStaff.set(row.staffId, samples);
        }

        const recentActivityByStaff = new Map(
            recentActivityRows.map((row) => [row.staffId, row.value]),
        );

        return staffProfiles.map((staff) => ({
            ...staff,
            recentActivityCount: recentActivityByStaff.get(staff.staffId) ?? 0,
            firstResponseSamples: samplesByStaff.get(staff.staffId) ?? [],
        }));
    }
}

export default new ResponseTimeService();

function isFiniteDate(date: Date | null | undefined): date is Date {
    return date instanceof Date && Number.isFinite(date.getTime());
}

function getTimeZoneParts(date: Date): { weekday: number; hour: number } | null {
    if (!isFiniteDate(date)) return null;

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

function normalizePresenceStatus(status: string | undefined): StaffStatus {
    if (status === 'online' || status === 'idle' || status === 'dnd' || status === 'invisible') {
        return status;
    }

    if (status === 'offline') return 'offline';
    return 'unknown';
}

function emptyStaffCapacity(): StaffCacheEntry {
    return {
        activeCount: 0,
        weightedCapacity: 0,
        statusBreakdown: emptyStatusBreakdown(),
        staffProfiles: [],
        fetchedAt: Date.now(),
    };
}

function emptyStatusBreakdown(): Record<StaffStatus, number> {
    return {
        online: 0,
        idle: 0,
        dnd: 0,
        busy: 0,
        offline: 0,
        invisible: 0,
        unknown: 0,
    };
}
