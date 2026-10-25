export interface EvaluationTicket {
    id: number;
    createdAt: Date;
    firstResponseAt: Date | null;
}

export interface ForecastSnapshot {
    ticketId: number;
    createdAt: Date;
    estimatedMs: number;
    modelVersion: string;
}

// Evaluate the forecast actually issued, rather than reconstructing unknown
// historical presence/queue state or training on responses that arrived later.
export function evaluateWaitEstimates(tickets: EvaluationTicket[], snapshots: ForecastSnapshot[]) {
    const forecasts = new Map<number, ForecastSnapshot[]>();
    for (const snapshot of snapshots) {
        const entries = forecasts.get(snapshot.ticketId) ?? [];
        entries.push(snapshot);
        forecasts.set(snapshot.ticketId, entries);
    }
    return tickets.flatMap((ticket) => {
        const start = ticket.createdAt.getTime();
        const end = ticket.firstResponseAt?.getTime();
        if (!Number.isFinite(start) || end == null || !Number.isFinite(end) || end <= start)
            return [];
        const forecast = (forecasts.get(ticket.id) ?? [])
            .filter(
                (entry) =>
                    entry.createdAt.getTime() >= start &&
                    entry.createdAt.getTime() < end &&
                    Number.isFinite(entry.estimatedMs) &&
                    entry.estimatedMs > 0,
            )
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        if (!forecast) return [];
        const actualMs = end - start;
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
