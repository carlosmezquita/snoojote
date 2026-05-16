/**
 * Wait Time Estimator - per-staff, capacity-weighted model.
 *
 * The model anchors on global and temporal response history, then blends in
 * the likely active responder pool when enough per-staff history exists.
 */

export const WAIT_ESTIMATOR_MODEL_VERSION = 'per-staff-capacity-v1';

export interface TicketResponseData {
    createdAt: Date;
    firstResponseAt: Date;
    staffCapacityAtCreation?: number | null;
    openTicketsAtCreation?: number | null;
}

export type StaffStatus = 'online' | 'idle' | 'dnd' | 'busy' | 'offline' | 'invisible' | 'unknown';

export interface StaffFirstResponseSample {
    occurredAt: Date;
    responseTimeMs: number;
}

export interface StaffResponseProfile {
    staffId: string;
    status: StaffStatus;
    isBot?: boolean;
    recentActivityCount?: number;
    firstResponseSamples?: StaffFirstResponseSample[];
}

export interface ResponderPoolEntry {
    staffId: string;
    status: StaffStatus;
    weight: number;
    presenceWeight: number;
    participationFactor: number;
    baselineMs: number;
    sampleCount: number;
    usesStaffBaseline: boolean;
}

export interface EstimationInput {
    /** Last answered tickets, ordered by createdAt DESC. */
    recentTickets: TicketResponseData[];
    /** Answered tickets matching current day-of-week + time block. */
    temporalTickets: TicketResponseData[];
    /** Answered tickets used as the global and historical-load fallback. */
    allTickets: TicketResponseData[];
    /** Currently active support staff profiles and history. */
    staffProfiles?: StaffResponseProfile[];
    /** Current timestamp. */
    now: Date;
    /** Number of open tickets with no first response before this ticket is added. */
    queueLength: number;
    /**
     * Legacy count fallback. Used only when staffProfiles are unavailable.
     * Prefer weighted capacity from staffProfiles.
     */
    activeStaff?: number;
    /** Optional precomputed historical load median. */
    historicalBaselineLoad?: number;
}

export interface EstimationFactors {
    modelVersion: string;
    globalTemporalBaseMs: number;
    recentMedianMs: number | null;
    temporalMedianMs: number | null;
    globalMedianMs: number | null;
    activeStaffBaseMs: number;
    activeStaffBlendWeight: number;
    blendedBaseMs: number;
    currentStaffCapacity: number;
    currentLoad: number;
    historicalBaselineLoad: number;
    loadMultiplier: number;
    responderPool: ResponderPoolEntry[];
}

export interface EstimationResult {
    estimatedMs: number;
    factors: EstimationFactors;
}

const ALPHA_FRESH = 0.6;
const ALPHA_STALE = 0.2;
const EPSILON = 0.25;
const FALLBACK_BASE_MS = 15 * 60 * 1000;
const MIN_TEMPORAL_TICKETS = 5;
const MIN_STAFF_SAMPLES = 5;
const STAFF_HISTORY_WINDOW_DAYS = 90;
const ACTIVE_STAFF_BLEND_MAX = 0.3;
const MIN_ESTIMATE_MS = 60 * 1000;
const MAX_ESTIMATE_MS = 24 * 60 * 60 * 1000;
const MIN_LOAD_MULTIPLIER = 0.6;
const MAX_LOAD_MULTIPLIER = 3.0;

export function computeMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function getTimeBlock(hour: number): number {
    return Math.floor(hour / 4);
}

export function extractResponseTimes(tickets: TicketResponseData[]): number[] {
    const times: number[] = [];
    for (const t of tickets) {
        const diff = t.firstResponseAt.getTime() - t.createdAt.getTime();
        if (Number.isFinite(diff) && diff > 0) times.push(diff);
    }
    return times;
}

export function computeAlpha(mostRecentCreatedAt: Date | null, now: Date): number {
    if (!mostRecentCreatedAt) return ALPHA_STALE;
    const ageMs = now.getTime() - mostRecentCreatedAt.getTime();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    return ageMs < twentyFourHoursMs ? ALPHA_FRESH : ALPHA_STALE;
}

/**
 * Current normalized queue load: (Q + 1) / max(S, 0.25).
 *
 * Kept under the old name for compatibility with existing tests/callers.
 */
export function computeLoadFactor(queueLength: number, activeStaff: number): number {
    return computeCurrentLoad(queueLength, activeStaff);
}

export function computePresenceWeight(status: StaffStatus): number {
    if (status === 'online') return 1;
    if (status === 'idle') return 0.5;
    if (status === 'dnd' || status === 'busy') return 0.25;
    return 0;
}

export function computeRecentParticipationFactor(recentActivityCount = 0): number {
    return 1 + Math.min(Math.max(recentActivityCount, 0), 5) * 0.08;
}

export function computeWeightedStaffCapacity(staffProfiles: StaffResponseProfile[] = []): number {
    return staffProfiles.reduce((total, staff) => {
        if (staff.isBot) return total;
        return total + computePresenceWeight(staff.status);
    }, 0);
}

export function computeWeightedMedian(entries: { value: number; weight: number }[]): number {
    const validEntries = entries
        .filter((entry) => entry.weight > 0 && Number.isFinite(entry.value))
        .sort((a, b) => a.value - b.value);

    if (validEntries.length === 0) return 0;

    const totalWeight = validEntries.reduce((total, entry) => total + entry.weight, 0);
    const midpoint = totalWeight / 2;
    let running = 0;

    for (const [index, entry] of validEntries.entries()) {
        running += entry.weight;
        if (running === midpoint && validEntries[index + 1]) {
            return (entry.value + validEntries[index + 1].value) / 2;
        }
        if (running > midpoint) return entry.value;
    }

    return validEntries[validEntries.length - 1].value;
}

export function buildResponderPool(
    staffProfiles: StaffResponseProfile[],
    globalTemporalBaseMs: number,
    now: Date,
): ResponderPoolEntry[] {
    return staffProfiles
        .filter((staff) => !staff.isBot)
        .map((staff) => {
            const presenceWeight = computePresenceWeight(staff.status);
            const participationFactor = computeRecentParticipationFactor(
                staff.recentActivityCount ?? 0,
            );
            const responseTimes = getRecentStaffResponseTimes(staff, now);
            const usesStaffBaseline = responseTimes.length >= MIN_STAFF_SAMPLES;

            return {
                staffId: staff.staffId,
                status: staff.status,
                weight: presenceWeight * participationFactor,
                presenceWeight,
                participationFactor,
                baselineMs: usesStaffBaseline ? computeMedian(responseTimes) : globalTemporalBaseMs,
                sampleCount: responseTimes.length,
                usesStaffBaseline,
            };
        })
        .filter((entry) => entry.weight > 0);
}

export function estimateWaitTime(input: EstimationInput): EstimationResult {
    const { recentTickets, temporalTickets, allTickets, now, queueLength } = input;

    const recentTimes = extractResponseTimes(recentTickets).slice(0, 20);
    const temporalTimes = extractResponseTimes(temporalTickets);
    const allTimes = extractResponseTimes(allTickets);

    const recentMedianMs = recentTimes.length > 0 ? computeMedian(recentTimes) : null;
    const temporalMedianMs =
        temporalTimes.length >= MIN_TEMPORAL_TICKETS ? computeMedian(temporalTimes) : null;
    const globalMedianMs = allTimes.length > 0 ? computeMedian(allTimes) : null;
    const globalTemporalBaseMs = computeGlobalTemporalBaseMs({
        recentTickets,
        recentMedianMs,
        temporalMedianMs,
        globalMedianMs,
        now,
    });

    const staffProfiles = input.staffProfiles ?? [];
    const responderPool = buildResponderPool(staffProfiles, globalTemporalBaseMs, now);
    const activeStaffBaseMs =
        responderPool.length > 0
            ? computeWeightedMedian(
                  responderPool.map((entry) => ({
                      value: entry.baselineMs,
                      weight: entry.weight,
                  })),
              )
            : globalTemporalBaseMs;

    const totalPoolWeight = responderPool.reduce((total, entry) => total + entry.weight, 0);
    const reliablePoolWeight = responderPool
        .filter((entry) => entry.usesStaffBaseline)
        .reduce((total, entry) => total + entry.weight, 0);
    const activeStaffBlendWeight =
        totalPoolWeight > 0 ? ACTIVE_STAFF_BLEND_MAX * (reliablePoolWeight / totalPoolWeight) : 0;
    const blendedBaseMs =
        globalTemporalBaseMs * (1 - activeStaffBlendWeight) +
        activeStaffBaseMs * activeStaffBlendWeight;

    const profileCapacity = computeWeightedStaffCapacity(staffProfiles);
    const currentStaffCapacity =
        staffProfiles.length > 0 ? profileCapacity : Math.max(input.activeStaff ?? 0, 0);
    const currentLoad = computeCurrentLoad(queueLength, currentStaffCapacity);
    const historicalBaselineLoad =
        input.historicalBaselineLoad ?? computeHistoricalBaselineLoad(allTickets);
    const loadMultiplier = clamp(
        currentLoad / historicalBaselineLoad,
        MIN_LOAD_MULTIPLIER,
        MAX_LOAD_MULTIPLIER,
    );

    const estimatedMs = clampEstimate(blendedBaseMs * loadMultiplier);

    return {
        estimatedMs,
        factors: {
            modelVersion: WAIT_ESTIMATOR_MODEL_VERSION,
            globalTemporalBaseMs,
            recentMedianMs,
            temporalMedianMs,
            globalMedianMs,
            activeStaffBaseMs,
            activeStaffBlendWeight,
            blendedBaseMs,
            currentStaffCapacity,
            currentLoad,
            historicalBaselineLoad,
            loadMultiplier,
            responderPool,
        },
    };
}

export function estimateWaitTimeMs(input: EstimationInput): number {
    return estimateWaitTime(input).estimatedMs;
}

export function formatDuration(ms: number): string {
    if (ms >= MAX_ESTIMATE_MS) {
        return '24+ hours';
    }

    const totalMinutes = Math.ceil(ms / (1000 * 60));

    if (totalMinutes < 60) {
        return `${totalMinutes} minute${totalMinutes !== 1 ? 's' : ''}`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (minutes === 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }

    return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
}

function computeGlobalTemporalBaseMs(input: {
    recentTickets: TicketResponseData[];
    recentMedianMs: number | null;
    temporalMedianMs: number | null;
    globalMedianMs: number | null;
    now: Date;
}): number {
    const fallbackBase = input.temporalMedianMs ?? input.globalMedianMs ?? FALLBACK_BASE_MS;

    if (input.recentMedianMs !== null) {
        const alpha = computeAlpha(
            input.recentTickets.length > 0 ? input.recentTickets[0].createdAt : null,
            input.now,
        );
        return alpha * input.recentMedianMs + (1 - alpha) * fallbackBase;
    }

    return fallbackBase;
}

function getRecentStaffResponseTimes(staff: StaffResponseProfile, now: Date): number[] {
    const cutoff = now.getTime() - STAFF_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    return (staff.firstResponseSamples ?? [])
        .filter(
            (sample) =>
                sample.occurredAt.getTime() >= cutoff &&
                Number.isFinite(sample.responseTimeMs) &&
                sample.responseTimeMs > 0,
        )
        .map((sample) => sample.responseTimeMs);
}

function computeCurrentLoad(queueLength: number, staffCapacity: number): number {
    return (Math.max(queueLength, 0) + 1) / Math.max(staffCapacity, EPSILON);
}

function computeHistoricalBaselineLoad(tickets: TicketResponseData[]): number {
    const loads = tickets
        .map((ticket) => {
            if (
                ticket.openTicketsAtCreation == null ||
                ticket.staffCapacityAtCreation == null ||
                !Number.isFinite(ticket.openTicketsAtCreation) ||
                !Number.isFinite(ticket.staffCapacityAtCreation)
            ) {
                return null;
            }

            return (
                (Math.max(ticket.openTicketsAtCreation, 0) + 1) /
                Math.max(ticket.staffCapacityAtCreation, EPSILON)
            );
        })
        .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);

    return loads.length > 0 ? computeMedian(loads) : 1;
}

function clampEstimate(ms: number): number {
    return clamp(ms, MIN_ESTIMATE_MS, MAX_ESTIMATE_MS);
}

function clamp(ms: number, min: number, max: number): number {
    return Math.max(min, Math.min(ms, max));
}
