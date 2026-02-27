/**
 * Wait Time Estimator — Hybrid Empirical-Load Algorithm.
 *
 * Combines an Exponential Moving Average for real-time system turbulence,
 * a Temporal Baseline for seasonality (day/time), and a Load Factor
 * derived from Little's Law to account for queue and staff availability.
 *
 * Formula:
 *   W_est = (α · M_recent + (1 - α) · H_{d,h}) × L(Q, S)
 *
 * Where:
 *   M_recent — Median response time of the last N answered tickets
 *   H_{d,h}  — Historical median for current day-of-week + 4-hour block
 *   α        — Recency weight (0.6 if recent data < 24h, 0.2 if stale)
 *   L(Q, S)  — Little's Law load factor: (Q + 1) / max(S, ε)
 *   Q        — Open tickets with no staff response yet
 *   S        — Active staff (online, dnd, or idle)
 *   ε        — 0.25 (prevents division by zero, models "waiting for login")
 *
 * All exported functions are pure (no side-effects, no DB access) so
 * they can be tested independently.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketResponseData {
    createdAt: Date;
    firstResponseAt: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Recency weight when fresh data exists (most recent ticket < 24h old). */
const ALPHA_FRESH = 0.6;

/** Recency weight when data is stale (most recent ticket ≥ 24h old). */
const ALPHA_STALE = 0.2;

/** Minimum active staff denominator — prevents division by zero and models
 *  the "waiting for someone to log in" delay (1 / 0.25 = 4× multiplier). */
const EPSILON = 0.25;

/** Fallback base time (ms) when no historical data exists at all. */
const FALLBACK_BASE_MS = 15 * 60 * 1000; // 15 minutes

/** Minimum number of time-block tickets before trusting H_{d,h}. */
const MIN_TEMPORAL_TICKETS = 5;

/** Minimum output clamp (ms). */
const MIN_ESTIMATE_MS = 60 * 1000; // 1 minute

/** Maximum output clamp (ms). */
const MAX_ESTIMATE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Compute the median of an array of numbers.
 * Returns 0 for empty arrays. Does not mutate the input.
 */
export function computeMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Map an hour (0–23) to a 4-hour time block (0–5).
 *   Block 0: 00:00–03:59
 *   Block 1: 04:00–07:59
 *   Block 2: 08:00–11:59
 *   Block 3: 12:00–15:59
 *   Block 4: 16:00–19:59
 *   Block 5: 20:00–23:59
 */
export function getTimeBlock(hour: number): number {
    return Math.floor(hour / 4);
}

/**
 * Extract positive response times (firstResponseAt − createdAt) in ms.
 * Skips invalid / negative values.
 */
export function extractResponseTimes(tickets: TicketResponseData[]): number[] {
    const times: number[] = [];
    for (const t of tickets) {
        const diff = t.firstResponseAt.getTime() - t.createdAt.getTime();
        if (diff > 0) times.push(diff);
    }
    return times;
}

/**
 * Determine α based on whether the most recent ticket is within 24 hours.
 */
export function computeAlpha(mostRecentCreatedAt: Date | null, now: Date): number {
    if (!mostRecentCreatedAt) return ALPHA_STALE;
    const ageMs = now.getTime() - mostRecentCreatedAt.getTime();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    return ageMs < twentyFourHoursMs ? ALPHA_FRESH : ALPHA_STALE;
}

/**
 * Little's Law load factor: L(Q, S) = (Q + 1) / max(S, ε).
 *
 * Q + 1 represents the new user's position in the unanswered queue.
 * When S = 0, the denominator is ε = 0.25, producing a 4× multiplier
 * per queued ticket — modelling the heavy delay of waiting for someone
 * to come online.
 */
export function computeLoadFactor(queueLength: number, activeStaff: number): number {
    return (queueLength + 1) / Math.max(activeStaff, EPSILON);
}

// ---------------------------------------------------------------------------
// Main estimation
// ---------------------------------------------------------------------------

export interface EstimationInput {
    /** Last N (up to 10) answered tickets, ordered by createdAt DESC. */
    recentTickets: TicketResponseData[];
    /** All answered tickets matching current day-of-week + time block (last 60 days). */
    temporalTickets: TicketResponseData[];
    /** All answered tickets (fallback for temporal baseline). */
    allTickets: TicketResponseData[];
    /** Current timestamp. */
    now: Date;
    /** Number of open tickets with no first response. */
    queueLength: number;
    /** Number of active staff (online / dnd / idle). */
    activeStaff: number;
}

/**
 * Estimate the wait time (in milliseconds) for a new ticket.
 *
 * Implements: W_est = (α · M_recent + (1 − α) · H_{d,h}) × L(Q, S)
 *
 * Returns the clamped estimate in milliseconds.
 */
export function estimateWaitTimeMs(input: EstimationInput): number {
    const { recentTickets, temporalTickets, allTickets, now, queueLength, activeStaff } = input;

    const loadFactor = computeLoadFactor(queueLength, activeStaff);

    // --- Zero-data fallback ---
    const recentTimes = extractResponseTimes(recentTickets);
    const allTimes = extractResponseTimes(allTickets);

    if (recentTimes.length === 0 && allTimes.length === 0) {
        return clamp(FALLBACK_BASE_MS * loadFactor);
    }

    // --- M_recent (median of last N answered tickets) ---
    const mRecent = recentTimes.length > 0 ? computeMedian(recentTimes) : null;

    // --- H_{d,h} (historical temporal baseline) ---
    const temporalTimes = extractResponseTimes(temporalTickets);
    let hDH: number | null = null;

    if (temporalTimes.length >= MIN_TEMPORAL_TICKETS) {
        hDH = computeMedian(temporalTimes);
    } else if (allTimes.length > 0) {
        // Fallback: global historical median
        hDH = computeMedian(allTimes);
    }

    // --- Compute base time ---
    let baseTime: number;

    if (mRecent !== null && hDH !== null) {
        const alpha = computeAlpha(
            recentTickets.length > 0 ? recentTickets[0].createdAt : null,
            now,
        );
        baseTime = alpha * mRecent + (1 - alpha) * hDH;
    } else if (mRecent !== null) {
        baseTime = mRecent;
    } else if (hDH !== null) {
        baseTime = hDH;
    } else {
        baseTime = FALLBACK_BASE_MS;
    }

    // --- Apply load factor and clamp ---
    return clamp(baseTime * loadFactor);
}

/**
 * Clamp the estimate to [1 minute, 24 hours].
 */
function clamp(ms: number): number {
    return Math.max(MIN_ESTIMATE_MS, Math.min(ms, MAX_ESTIMATE_MS));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Human-readable duration string.
 * At the 24-hour cap, displays "24+ hours" to manage expectations.
 */
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
