import { type WaitOutcome } from './ticketWaitLifecycle.js';

export interface EvaluationTicket {
    id: number;
    createdAt: Date;
    firstResponseAt: Date | null;
    firstResponseBy?: string | null;
    userId?: string;
    status?: string;
    waitOutcome?: WaitOutcome | null;
    waitEndedAt?: Date | null;
    requesterUnavailableAt?: Date | null;
    closedAt?: Date | null;
    closedBy?: string | null;
    deletedAt?: Date | null;
}

export interface ForecastSnapshot {
    ticketId: number;
    createdAt: Date;
    estimatedMs: number;
    modelVersion: string;
}

export type ObservationOutcome = WaitOutcome | 'pending' | 'unknown' | 'invalid';
export interface WaitObservation {
    outcome: ObservationOutcome;
    source: 'recorded' | 'legacy';
    endedAt: Date | null;
    observedMs: number | null;
}

// These are outcomes of the INITIAL wait, not resolution time or reopened episodes.
// Pending waits are administratively censored at asOf. Other non-response outcomes
// are competing events and must never be converted into fake response samples.
export function observeInitialWait(ticket: EvaluationTicket, asOf: Date): WaitObservation {
    const start = ticket.createdAt.getTime();
    const cutoff = asOf.getTime();
    const source = ticket.waitOutcome ? 'recorded' : 'legacy';
    const observation = (outcome: ObservationOutcome, endedAt: Date | null): WaitObservation => ({
        outcome,
        source,
        endedAt,
        observedMs:
            outcome === 'invalid' || outcome === 'unknown'
                ? null
                : (endedAt?.getTime() ?? cutoff) - start,
    });
    if (!Number.isFinite(start) || !Number.isFinite(cutoff) || start > cutoff)
        return observation('invalid', null);
    if (
        [
            ticket.firstResponseAt,
            ticket.closedAt,
            ticket.deletedAt,
            ticket.requesterUnavailableAt,
        ].some(
            (date) => date != null && (!Number.isFinite(date.getTime()) || date.getTime() < start),
        )
    )
        return observation('invalid', null);
    if (ticket.waitOutcome) {
        const end = ticket.waitEndedAt?.getTime();
        if (end == null || !Number.isFinite(end) || end < start)
            return observation('invalid', null);
        if (end > cutoff) return observation('pending', null);
        if (
            ticket.waitOutcome === 'responded' &&
            (ticket.firstResponseAt?.getTime() !== end ||
                (ticket.userId != null && ticket.firstResponseBy === ticket.userId))
        )
            return observation('invalid', null);
        return observation(ticket.waitOutcome, ticket.waitEndedAt!);
    }

    // Legacy rows have no immutable outcome. Use only timestamps actually present;
    // never guess when an unknown/departed user left or when a deleted ticket closed.
    const candidates: { outcome: ObservationOutcome; at: Date }[] = [];
    const add = (outcome: ObservationOutcome, at: Date | null | undefined) => {
        if (at && Number.isFinite(at.getTime()) && at.getTime() >= start && at.getTime() <= cutoff)
            candidates.push({ outcome, at });
    };
    if (!(ticket.userId != null && ticket.firstResponseBy === ticket.userId))
        add('responded', ticket.firstResponseAt);
    add(
        ticket.closedBy == null
            ? 'closed_unknown'
            : ticket.closedBy === ticket.userId
              ? 'requester_closed'
              : 'staff_closed',
        ticket.closedAt,
    );
    add('deleted', ticket.deletedAt);
    add('requester_unavailable', ticket.requesterUnavailableAt);
    // At second precision, prefer a non-response outcome when event order is unknown.
    candidates.sort(
        (a, b) =>
            a.at.getTime() - b.at.getTime() ||
            Number(a.outcome === 'responded') - Number(b.outcome === 'responded'),
    );
    const first = candidates[0];
    if (first) return observation(first.outcome, first.at);
    if (
        ['closed', 'deleted', 'creation_failed', 'creating'].includes(ticket.status ?? '') &&
        !ticket.closedAt &&
        !ticket.deletedAt &&
        !ticket.firstResponseAt
    )
        return observation('unknown', null);
    if (ticket.userId != null && ticket.firstResponseBy === ticket.userId && ticket.firstResponseAt)
        return observation('invalid', null);
    return observation('pending', null);
}

export function selectIssuedForecast(snapshots: ForecastSnapshot[], start: Date, before: Date) {
    return snapshots
        .filter(
            (entry) =>
                entry.createdAt.getTime() >= start.getTime() &&
                entry.createdAt.getTime() < before.getTime() &&
                Number.isFinite(entry.estimatedMs) &&
                entry.estimatedMs > 0,
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
}

// Evaluate the forecast actually issued, rather than reconstructing unknown
// historical presence/queue state or learning from responses after the cutoff.
export function evaluateWaitEstimates(
    tickets: EvaluationTicket[],
    snapshots: ForecastSnapshot[],
    asOf = new Date(),
) {
    const forecasts = new Map<number, ForecastSnapshot[]>();
    for (const snapshot of snapshots) {
        const entries = forecasts.get(snapshot.ticketId) ?? [];
        entries.push(snapshot);
        forecasts.set(snapshot.ticketId, entries);
    }
    return tickets.flatMap((ticket) => {
        const observation = observeInitialWait(ticket, asOf);
        if (observation.outcome !== 'responded' || !observation.endedAt) return [];
        const forecast = selectIssuedForecast(
            forecasts.get(ticket.id) ?? [],
            ticket.createdAt,
            observation.endedAt,
        );
        if (!forecast) return [];
        // An estimate announces the wait remaining from issuance, not time already elapsed.
        const actualMs = observation.endedAt.getTime() - forecast.createdAt.getTime();
        return [
            {
                id: ticket.id,
                modelVersion: forecast.modelVersion,
                predictedMs: forecast.estimatedMs,
                actualMs,
                errorMs: forecast.estimatedMs - actualMs,
            },
        ];
    });
}
