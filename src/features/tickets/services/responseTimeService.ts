import { type Guild } from 'discord.js';
import db from '../../../database/db.js';
import {
    ticketStaffActivity,
    tickets,
    ticketWaitEstimateSnapshots,
} from '../../../database/schema.js';
import { desc, isNotNull, eq, ne, and, or, isNull, count, gte, inArray } from 'drizzle-orm';
import {
    WAIT_ESTIMATOR_MODEL_VERSION,
    type EstimationResult,
    type StaffResponseProfile,
    type StaffStatus,
    type TicketResponseData,
    computeMedian,
    computePresenceWeight,
    getTimeBlock,
    estimateWaitTime,
    formatDuration,
} from './waitTimeEstimator.js';
import logger from '../../../utils/logger.js';
import { SingleFlight } from '../../../shared/services/SingleFlight.js';
import { getTicketStaffRoleIds, isTicketStaff } from '../utils/ticketStaff.js';

// ---------------------------------------------------------------------------
// Gateway membership bootstrap and short-lived availability snapshots
// ---------------------------------------------------------------------------

interface StaffCacheEntry {
    activeCount: number;
    weightedCapacity: number;
    statusBreakdown: Record<StaffStatus, number>;
    staffProfiles: StaffResponseProfile[];
    missingRoleIds: string[];
    fetchedAt: number;
    fromCache: boolean;
}

interface StaffAvailabilitySnapshot {
    activeCount: number;
    totalStaffCount: number;
    activeByStatus: Record<StaffStatus, number>;
    staffProfiles: StaffResponseProfile[];
    missingRoleIds: string[];
    fetchedAt: number;
    fromCache: boolean;
}

interface EnrichedStaffProfileCacheEntry {
    profiles: StaffResponseProfile[];
    fetchedAt: number;
}

interface HistoricalLoadCacheEntry {
    value: number;
    fetchedAt: number;
}

const STAFF_CACHE_TTL_MS = 30 * 1000;
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const HISTORICAL_LOAD_CACHE_TTL_MS = 5 * 60 * 1000;
const EPSILON_STAFF_CAPACITY = 0.25;
const staffCache = new Map<string, StaffCacheEntry>();
const enrichedStaffProfileCache = new Map<string, EnrichedStaffProfileCacheEntry>();
let historicalLoadCache: HistoricalLoadCacheEntry | null = null;
const ESTIMATION_TIME_ZONE = 'Europe/Madrid';
const timeZoneFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ESTIMATION_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
});

type ResponseHistoryRow = Pick<
    typeof tickets.$inferSelect,
    | 'createdAt'
    | 'firstResponseAt'
    | 'staffCapacityAtCreation'
    | 'openTicketsAtCreation'
    | 'unansweredTicketsAtCreation'
>;
export class ResponseTimeService {
    private historyCache?: {
        expiresAt: number;
        recentRows: ResponseHistoryRow[];
        historicalRows: ResponseHistoryRow[];
    };

    private readonly loadedGuilds = new Set<string>();
    private readonly capacityLoads = new SingleFlight<string, StaffCacheEntry>();
    private readonly memberLoads = new SingleFlight<string, void>();
    private readonly bootstrapRetryAt = new Map<string, number>();
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
        db.transaction(
            (tx) => {
                const ticket = tx.select().from(tickets).where(eq(tickets.id, ticketId)).get();
                if (
                    !ticket ||
                    !['open', 'creating'].includes(ticket.status) ||
                    ticket.channelId.startsWith('pending:') ||
                    ticket.userId === staffId ||
                    !isFiniteDate(timestamp) ||
                    timestamp < ticket.createdAt ||
                    ticket.requesterUnavailableAt
                )
                    return;
                if (
                    messageId &&
                    tx
                        .select({ id: ticketStaffActivity.id })
                        .from(ticketStaffActivity)
                        .where(
                            and(
                                eq(ticketStaffActivity.ticketId, ticketId),
                                eq(ticketStaffActivity.messageId, messageId),
                            ),
                        )
                        .limit(1)
                        .get()
                )
                    return;
                let responseTimeMs: number | null = null;
                if (!ticket.firstResponseAt) {
                    if (!ticket.waitOutcome)
                        responseTimeMs = timestamp.getTime() - ticket.createdAt.getTime();
                    tx.update(tickets)
                        .set({
                            firstResponseAt: timestamp,
                            firstResponseBy: staffId,
                            ...(!ticket.waitOutcome
                                ? { waitOutcome: 'responded' as const, waitEndedAt: timestamp }
                                : {}),
                        })
                        .where(eq(tickets.id, ticketId))
                        .run();
                    historicalLoadCache = null;
                    this.historyCache = undefined;
                }
                tx.insert(ticketStaffActivity)
                    .values({
                        ticketId,
                        staffId,
                        action: 'message',
                        messageId,
                        occurredAt: timestamp,
                        responseTimeMs,
                    })
                    .run();
                enrichedStaffProfileCache.clear();
            },
            { behavior: 'immediate' },
        );
    }

    invalidateGuild(guildId: string) {
        this.loadedGuilds.delete(guildId);
        this.bootstrapRetryAt.delete(guildId);
        staffCache.delete(guildId);
        enrichedStaffProfileCache.delete(guildId);
    }

    async getActiveStaffCount(
        guild: Guild,
        options: { forceRefresh?: boolean } = {},
    ): Promise<number> {
        return (await this.getStaffCapacity(guild, options)).activeCount;
    }

    async getWeightedStaffCapacity(guild: Guild): Promise<number> {
        return (await this.getStaffCapacity(guild)).weightedCapacity;
    }

    async getStaffAvailability(
        guild: Guild,
        options: { forceRefresh?: boolean } = {},
    ): Promise<StaffAvailabilitySnapshot> {
        const capacity = await this.getStaffCapacity(guild, options);
        return {
            activeCount: capacity.activeCount,
            totalStaffCount: capacity.staffProfiles.length,
            activeByStatus: capacity.statusBreakdown,
            staffProfiles: capacity.staffProfiles,
            missingRoleIds: capacity.missingRoleIds,
            fetchedAt: capacity.fetchedAt,
            fromCache: capacity.fromCache,
        };
    }

    /**
     * Fetches current ticket staff status, excluding bots, and converts it to
     * weighted capacity: online 1.0, idle 0.5, dnd 0.25, offline/unknown 0.
     */
    async getStaffCapacity(
        guild: Guild,
        options: { forceRefresh?: boolean } = {},
    ): Promise<StaffCacheEntry> {
        return this.capacityLoads.run(
            `${guild.id}:${options.forceRefresh ? 'force' : 'normal'}`,
            () => this.computeStaffCapacity(guild, options),
        );
    }

    private async computeStaffCapacity(
        guild: Guild,
        options: { forceRefresh?: boolean },
    ): Promise<StaffCacheEntry> {
        const cacheKey = guild.id;
        const cached = staffCache.get(cacheKey);

        if (
            cached &&
            ((this.bootstrapRetryAt.get(guild.id) ?? 0) > Date.now() ||
                (!options.forceRefresh && Date.now() - cached.fetchedAt < STAFF_CACHE_TTL_MS))
        ) {
            return { ...cached, fromCache: true };
        }

        const staffRoleIds = getTicketStaffRoleIds();

        let members;
        try {
            // Requires the GuildPresences intent to avoid undercounting active staff.
            await this.memberLoads.run(guild.id, async () => {
                if (this.loadedGuilds.has(guild.id)) return;
                await guild.members.fetch({ withPresences: true });
                this.loadedGuilds.add(guild.id);
                this.bootstrapRetryAt.delete(guild.id);
            });
            members = guild.members.cache;
        } catch (error) {
            logger.warn('Staff membership bootstrap failed', { guildId: guild.id, error });
            this.bootstrapRetryAt.set(guild.id, Date.now() + STAFF_CACHE_TTL_MS);
            if (cached) {
                return { ...cached, fromCache: true };
            }

            const empty = emptyStaffCapacity(staffRoleIds);
            staffCache.set(cacheKey, empty);
            return empty;
        }

        const missingRoleIds = staffRoleIds.filter((roleId) => !guild.roles.cache.has(roleId));
        const staffProfiles: StaffResponseProfile[] = [];
        const statusBreakdown = emptyStatusBreakdown();

        members.forEach((member) => {
            if (!isTicketStaff(member)) return;

            const status = normalizePresenceStatus(
                member.presence?.status ?? guild.presences.cache.get(member.id)?.status,
            );
            statusBreakdown[status] += 1;
            staffProfiles.push({
                staffId: member.id,
                status,
                isBot: member.user.bot,
            });
        });

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
            missingRoleIds,
            fetchedAt: Date.now(),
            fromCache: false,
        };
        staffCache.set(cacheKey, entry);
        return entry;
    }

    /**
     * Counts the number of currently open tickets that have NOT yet
     * received a staff response. This is the unanswered queue (Q).
     */
    async getUnansweredQueueLength(guildId?: string, excludeTicketId?: number): Promise<number> {
        const result = await db
            .select({ value: count() })
            .from(tickets)
            .where(
                and(
                    inArray(tickets.status, ['open', 'creating']),
                    isNull(tickets.firstResponseAt),
                    isNull(tickets.requesterUnavailableAt),
                    guildId ? eq(tickets.guildId, guildId) : undefined,
                    excludeTicketId !== undefined ? ne(tickets.id, excludeTicketId) : undefined,
                ),
            )
            .get();

        return result?.value ?? 0;
    }

    /**
     * Counts the number of currently open tickets (all, regardless of response).
     * Used for recording context data at ticket creation.
     */
    async getOpenTicketCount(guildId?: string, excludeTicketId?: number): Promise<number> {
        const result = await db
            .select({ value: count() })
            .from(tickets)
            .where(
                and(
                    inArray(tickets.status, ['open', 'creating']),
                    guildId ? eq(tickets.guildId, guildId) : undefined,
                    excludeTicketId !== undefined ? ne(tickets.id, excludeTicketId) : undefined,
                ),
            )
            .get();

        return result?.value ?? 0;
    }

    /**
     * Calculates the estimated wait time for a new ticket using the per-staff,
     * capacity-weighted model.
     */
    async getEstimatedWaitTime(
        guild: Guild,
        options: { forceRefresh?: boolean } = {},
    ): Promise<string> {
        return formatDuration((await this.createEstimate(guild, undefined, options)).estimatedMs);
    }

    async createEstimate(
        guild: Guild,
        queueLengthOverride?: number,
        options: { forceRefresh?: boolean } = {},
    ): Promise<EstimationResult> {
        const now = new Date();

        // Recent baseline: last 20 answered tickets.
        const { recentRows, historicalRows } = this.readResponseHistory(now);

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
                unansweredTicketsAtCreation: r.unansweredTicketsAtCreation,
            }));

        // Temporal baseline: same day-of-week + 4-hour block, last 60 days.
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        const currentParts = getTimeZoneParts(now)!;
        const currentDay = currentParts.weekday;
        const currentBlock = getTimeBlock(currentParts.hour);

        // Filter in-app for matching day-of-week + time block
        // (SQLite timestamp mode makes SQL-level day/hour extraction impractical)
        const temporalTickets: TicketResponseData[] = historicalRows
            .filter((r) => {
                if (
                    !isFiniteDate(r.createdAt) ||
                    r.createdAt < sixtyDaysAgo ||
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
                unansweredTicketsAtCreation: r.unansweredTicketsAtCreation,
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
                unansweredTicketsAtCreation: r.unansweredTicketsAtCreation,
            }));

        const queueLength = queueLengthOverride ?? (await this.getUnansweredQueueLength(guild.id));
        const staffCapacity = await this.getStaffCapacity(guild, options);
        const staffProfiles = await this.enrichStaffProfiles(
            staffCapacity.staffProfiles,
            now,
            guild.id,
        );

        const estimate = estimateWaitTime({
            recentTickets,
            temporalTickets,
            allTickets,
            staffProfiles,
            now,
            queueLength,
            historicalBaselineLoad: this.getCachedHistoricalBaselineLoad(allTickets),
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

    private readResponseHistory(now: Date) {
        if (this.historyCache && this.historyCache.expiresAt > Date.now()) return this.historyCache;
        const projection = {
            createdAt: tickets.createdAt,
            firstResponseAt: tickets.firstResponseAt,
            staffCapacityAtCreation: tickets.staffCapacityAtCreation,
            openTicketsAtCreation: tickets.openTicketsAtCreation,
            unansweredTicketsAtCreation: tickets.unansweredTicketsAtCreation,
        };
        const recentRows = db
            .select(projection)
            .from(tickets)
            .where(
                and(
                    isNotNull(tickets.firstResponseAt),
                    or(isNull(tickets.waitOutcome), eq(tickets.waitOutcome, 'responded')),
                    or(
                        isNull(tickets.firstResponseBy),
                        ne(tickets.firstResponseBy, tickets.userId),
                    ),
                ),
            )
            .orderBy(desc(tickets.createdAt))
            .limit(20)
            .all();
        const historicalRows = db
            .select(projection)
            .from(tickets)
            .where(
                and(
                    isNotNull(tickets.firstResponseAt),
                    or(isNull(tickets.waitOutcome), eq(tickets.waitOutcome, 'responded')),
                    or(
                        isNull(tickets.firstResponseBy),
                        ne(tickets.firstResponseBy, tickets.userId),
                    ),
                    gte(tickets.firstResponseAt, new Date(now.getTime() - 60 * 86_400_000)),
                ),
            )
            .orderBy(desc(tickets.firstResponseAt))
            .limit(5000)
            .all();
        this.historyCache = { expiresAt: Date.now() + 30_000, recentRows, historicalRows };
        return this.historyCache;
    }

    async recordEstimateSnapshot(
        ticketId: number,
        estimate: EstimationResult,
        issuedAt = new Date(),
    ): Promise<void> {
        await db.insert(ticketWaitEstimateSnapshots).values({
            ticketId,
            modelVersion: estimate.factors.modelVersion,
            estimatedMs: estimate.estimatedMs,
            factorDetails: estimate.factors,
            createdAt: issuedAt,
        });
    }

    async getWaitEstimateDebug(
        guild: Guild,
        options: { forceRefresh?: boolean } = {},
    ): Promise<{
        estimate: EstimationResult;
        statusBreakdown: Record<StaffStatus, number>;
        staffProfiles: StaffResponseProfile[];
        missingRoleIds: string[];
        weightedStaffCapacity: number;
        fromCache: boolean;
    }> {
        const staffCapacity = await this.getStaffCapacity(guild, options);
        return {
            estimate: await this.createEstimate(guild),
            statusBreakdown: staffCapacity.statusBreakdown,
            staffProfiles: staffCapacity.staffProfiles,
            missingRoleIds: staffCapacity.missingRoleIds,
            weightedStaffCapacity: staffCapacity.weightedCapacity,
            fromCache: staffCapacity.fromCache,
        };
    }

    private async enrichStaffProfiles(
        staffProfiles: StaffResponseProfile[],
        now: Date,
        guildId: string,
    ): Promise<StaffResponseProfile[]> {
        if (staffProfiles.length === 0) return [];

        const staffIds = staffProfiles.map((staff) => staff.staffId);
        const cacheKey = guildId;
        const cached = enrichedStaffProfileCache.get(cacheKey);

        if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL_MS) {
            const byStaffId = new Map(cached.profiles.map((profile) => [profile.staffId, profile]));

            return staffProfiles.map((staff) => ({
                ...staff,
                recentActivityCount: byStaffId.get(staff.staffId)?.recentActivityCount ?? 0,
                firstResponseSamples: byStaffId.get(staff.staffId)?.firstResponseSamples ?? [],
            }));
        }

        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const firstResponseRows = await db
            .select({
                staffId: ticketStaffActivity.staffId,
                occurredAt: ticketStaffActivity.occurredAt,
                responseTimeMs: ticketStaffActivity.responseTimeMs,
            })
            .from(ticketStaffActivity)
            .innerJoin(tickets, eq(tickets.id, ticketStaffActivity.ticketId))
            .where(
                and(
                    inArray(ticketStaffActivity.staffId, staffIds),
                    eq(ticketStaffActivity.action, 'message'),
                    isNotNull(ticketStaffActivity.responseTimeMs),
                    ne(ticketStaffActivity.staffId, tickets.userId),
                    or(isNull(tickets.waitOutcome), eq(tickets.waitOutcome, 'responded')),
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

        const enrichedProfiles = staffProfiles.map((staff) => ({
            ...staff,
            recentActivityCount: recentActivityByStaff.get(staff.staffId) ?? 0,
            firstResponseSamples: samplesByStaff.get(staff.staffId) ?? [],
        }));

        enrichedStaffProfileCache.set(cacheKey, {
            profiles: enrichedProfiles,
            fetchedAt: Date.now(),
        });

        return enrichedProfiles;
    }

    private getCachedHistoricalBaselineLoad(tickets: TicketResponseData[]): number {
        if (
            historicalLoadCache &&
            Date.now() - historicalLoadCache.fetchedAt < HISTORICAL_LOAD_CACHE_TTL_MS
        ) {
            return historicalLoadCache.value;
        }

        const loads = tickets
            .map((ticket) => {
                if (
                    ticket.unansweredTicketsAtCreation == null ||
                    ticket.staffCapacityAtCreation == null ||
                    !Number.isFinite(ticket.unansweredTicketsAtCreation) ||
                    !Number.isFinite(ticket.staffCapacityAtCreation)
                ) {
                    return null;
                }

                return (
                    (Math.max(ticket.unansweredTicketsAtCreation, 0) + 1) /
                    Math.max(ticket.staffCapacityAtCreation, EPSILON_STAFF_CAPACITY)
                );
            })
            .filter(
                (value): value is number => value != null && Number.isFinite(value) && value > 0,
            );

        const value = loads.length > 0 ? computeMedian(loads) : 1;
        historicalLoadCache = { value, fetchedAt: Date.now() };
        return value;
    }
}

export default new ResponseTimeService();

function isFiniteDate(date: Date | null | undefined): date is Date {
    return date instanceof Date && Number.isFinite(date.getTime());
}

function getTimeZoneParts(date: Date): { weekday: number; hour: number } | null {
    if (!isFiniteDate(date)) return null;

    const parts = Object.fromEntries(
        timeZoneFormatter
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

function emptyStaffCapacity(missingRoleIds: string[] = []): StaffCacheEntry {
    return {
        activeCount: 0,
        weightedCapacity: 0,
        statusBreakdown: emptyStatusBreakdown(),
        staffProfiles: [],
        missingRoleIds,
        fetchedAt: Date.now(),
        fromCache: false,
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
