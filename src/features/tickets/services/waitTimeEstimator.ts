/**
 * Wait Time Estimator — Kernel-based weighted estimation algorithm.
 *
 * Uses non-parametric kernel regression over historical ticket data to
 * produce accurate wait-time estimates. Each historical data point is
 * weighted by its similarity to the current context across multiple
 * dimensions:
 *
 *   1. Hour of day   (cyclical Gaussian kernel, σ = 3 h)
 *   2. Day of week   (cyclical Gaussian kernel, σ = 1.5 d)
 *   3. Month of year (cyclical Gaussian kernel, σ = 2 mo)
 *   4. Recency        (exponential decay, half-life ≈ 60 days)
 *
 * After computing the weighted mean of historical response times the
 * result is adjusted by two real-time factors:
 *
 *   • Staff availability  – fewer online staff → longer wait
 *   • Queue depth         – more open tickets  → longer wait
 *
 * Exported functions are pure (no side-effects, no DB access) so they
 * can be tested independently.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoricalTicket {
    createdAt: Date;
    firstResponseAt: Date;
    staffOnlineAtCreation?: number | null;
    openTicketsAtCreation?: number | null;
}

export interface EstimationContext {
    now: Date;
    onlineStaff: number;
    openTickets: number;
}

// ---------------------------------------------------------------------------
// Kernel bandwidth parameters
// ---------------------------------------------------------------------------

/** Standard deviation for hour-of-day kernel (hours). */
const HOUR_SIGMA = 3;

/** Standard deviation for day-of-week kernel (days). */
const DAY_SIGMA = 1.5;

/** Standard deviation for month-of-year kernel (months). */
const MONTH_SIGMA = 2;

/** Decay constant for recency kernel (days). ln(2)/λ ≈ half-life of 60 days. */
const RECENCY_LAMBDA = 90;

/** Minimum total weight required to trust the kernel estimate. */
const MIN_TOTAL_WEIGHT = 0.5;

/** Minimum number of historical tickets for kernel estimation. */
const MIN_TICKETS = 5;

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Cyclical (wrapped) distance between two values on a circle of `period`.
 * E.g. cyclicalDistance(23, 1, 24) → 2  (not 22).
 */
export function cyclicalDistance(a: number, b: number, period: number): number {
    const diff = Math.abs(a - b);
    return Math.min(diff, period - diff);
}

/**
 * Gaussian kernel: exp(-d² / (2σ²)).
 */
export function gaussianKernel(distance: number, sigma: number): number {
    return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

/**
 * Exponential decay kernel: exp(-ageDays / λ).
 */
export function recencyKernel(ageDays: number, lambda: number): number {
    return Math.exp(-ageDays / lambda);
}

/**
 * Compute the composite weight for a single historical ticket relative to
 * the current context.
 */
export function computeWeight(
    ticket: HistoricalTicket,
    ctx: EstimationContext,
): number {
    const ticketDate = ticket.createdAt;
    const nowDate = ctx.now;

    // Temporal features
    const hourDist = cyclicalDistance(nowDate.getUTCHours(), ticketDate.getUTCHours(), 24);
    const dayDist = cyclicalDistance(nowDate.getUTCDay(), ticketDate.getUTCDay(), 7);
    const monthDist = cyclicalDistance(nowDate.getUTCMonth(), ticketDate.getUTCMonth(), 12);

    const wHour = gaussianKernel(hourDist, HOUR_SIGMA);
    const wDay = gaussianKernel(dayDist, DAY_SIGMA);
    const wMonth = gaussianKernel(monthDist, MONTH_SIGMA);

    // Recency
    const ageDays = (nowDate.getTime() - ticketDate.getTime()) / (1000 * 60 * 60 * 24);
    const wRecency = recencyKernel(Math.max(ageDays, 0), RECENCY_LAMBDA);

    return wHour * wDay * wMonth * wRecency;
}

/**
 * Compute the staff-availability adjustment factor.
 *
 * When historical tickets recorded their staff count we can compare
 * current availability to the historical median.  Otherwise we fall
 * back to a simpler heuristic: more staff online → shorter wait.
 */
export function staffAdjustmentFactor(
    historicalTickets: HistoricalTicket[],
    currentOnlineStaff: number,
): number {
    // Collect recorded staff counts
    const staffCounts = historicalTickets
        .map(t => t.staffOnlineAtCreation)
        .filter((v): v is number => v != null && v > 0);

    if (staffCounts.length >= MIN_TICKETS) {
        // Use median historical staff count as baseline
        staffCounts.sort((a, b) => a - b);
        const median = staffCounts[Math.floor(staffCounts.length / 2)];
        // Ratio: if current staff < median → factor > 1 (longer wait)
        return median / Math.max(currentOnlineStaff, 1);
    }

    // Fallback: no historical staff data yet.
    // Use a softer heuristic — each additional online staff member reduces
    // the estimate (diminishing returns via square-root scaling).
    return 1 / Math.sqrt(Math.max(currentOnlineStaff, 1));
}

/**
 * Compute the queue-depth adjustment factor.
 *
 * More open tickets at creation correlated with longer response times.
 * We compare the current queue depth against the historical median.
 */
export function queueAdjustmentFactor(
    historicalTickets: HistoricalTicket[],
    currentOpenTickets: number,
): number {
    const queueCounts = historicalTickets
        .map(t => t.openTicketsAtCreation)
        .filter((v): v is number => v != null && v >= 0);

    if (queueCounts.length >= MIN_TICKETS) {
        queueCounts.sort((a, b) => a - b);
        const median = queueCounts[Math.floor(queueCounts.length / 2)];
        // Linear scaling relative to median, clamped to reasonable bounds.
        const ratio = (currentOpenTickets + 1) / (median + 1);
        return Math.max(0.5, Math.min(ratio, 3));
    }

    // Fallback: slight linear increase per open ticket, capped.
    return Math.max(1, Math.min(1 + currentOpenTickets * 0.15, 3));
}

// ---------------------------------------------------------------------------
// Main estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the wait time (in milliseconds) for a new ticket.
 *
 * Returns `null` when there is not enough historical data.
 */
export function estimateWaitTimeMs(
    historicalTickets: HistoricalTicket[],
    ctx: EstimationContext,
): number | null {
    if (historicalTickets.length < MIN_TICKETS) {
        return null;
    }

    // 1. Compute kernel-weighted mean of historical response times.
    let weightedSum = 0;
    let totalWeight = 0;

    for (const ticket of historicalTickets) {
        const responseMs = ticket.firstResponseAt.getTime() - ticket.createdAt.getTime();
        if (responseMs <= 0) continue; // skip bad data

        const w = computeWeight(ticket, ctx);
        weightedSum += w * responseMs;
        totalWeight += w;
    }

    if (totalWeight < MIN_TOTAL_WEIGHT) {
        // Weights too small → fall back to simple average.
        let sum = 0;
        let count = 0;
        for (const ticket of historicalTickets) {
            const responseMs = ticket.firstResponseAt.getTime() - ticket.createdAt.getTime();
            if (responseMs > 0) {
                sum += responseMs;
                count++;
            }
        }
        if (count === 0) return null;
        return sum / count;
    }

    const baseEstimate = weightedSum / totalWeight;

    // 2. Apply real-time adjustments.
    const staffFactor = staffAdjustmentFactor(historicalTickets, ctx.onlineStaff);
    const queueFactor = queueAdjustmentFactor(historicalTickets, ctx.openTickets);

    const adjusted = baseEstimate * staffFactor * queueFactor;

    // 3. Clamp to reasonable bounds (1 minute – 48 hours).
    const ONE_MINUTE = 60 * 1000;
    const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
    return Math.max(ONE_MINUTE, Math.min(adjusted, FORTY_EIGHT_HOURS));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Human-readable duration string.
 */
export function formatDuration(ms: number): string {
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
