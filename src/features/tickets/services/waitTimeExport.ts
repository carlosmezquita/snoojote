import { type tickets, type ticketWaitEstimateSnapshots } from '../../../database/schema.js';
import { observeInitialWait } from './waitTimeEvaluation.js';

type ExportTicket = typeof tickets.$inferSelect;
type ExportSnapshot = typeof ticketWaitEstimateSnapshots.$inferSelect;

export function formatWaitObservationsCsv(
    rows: ExportTicket[],
    snapshots: ExportSnapshot[],
    asOf: Date,
): string {
    const grouped = new Map<number, ExportSnapshot[]>();
    for (const snapshot of snapshots) {
        const group = grouped.get(snapshot.ticketId) ?? [];
        group.push(snapshot);
        grouped.set(snapshot.ticketId, group);
    }
    const lines: string[] = [];
    const csv = (values: (string | number | boolean | null | undefined)[]) =>
        values.map((value) => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',');
    const iso = (date: Date | null) => date?.toISOString() ?? '';
    lines.push(
        csv([
            'exported_at_utc',
            'ticket_id',
            'ticket_status',
            'ticket_option',
            'ticket_created_at_utc',
            'first_response_at_utc',
            'closed_at_utc',
            'deleted_at_utc',
            'requester_unavailable_at_utc',
            'initial_wait_outcome',
            'outcome_source',
            'wait_ended_at_utc',
            'observed_wait_ms',
            'actual_first_response_ms',
            'snapshot_id',
            'model_version',
            'estimated_ms',
            'snapshot_created_at_utc',
            'forecast_before_outcome',
            'unanswered_tickets_at_creation',
            'staff_capacity_at_creation',
            'factor_details_json',
        ]),
    );
    for (const row of rows) {
        const outcome = observeInitialWait(row, asOf);
        for (const snapshot of grouped.get(row.id) ?? [null]) {
            lines.push(
                csv([
                    iso(asOf),
                    row.id,
                    row.status,
                    row.optionId,
                    iso(row.createdAt),
                    iso(row.firstResponseAt),
                    iso(row.closedAt),
                    iso(row.deletedAt),
                    iso(row.requesterUnavailableAt),
                    outcome.outcome,
                    outcome.source,
                    iso(outcome.endedAt),
                    outcome.observedMs,
                    outcome.outcome === 'responded' ? outcome.observedMs : null,
                    snapshot?.id,
                    snapshot?.modelVersion,
                    snapshot?.estimatedMs,
                    iso(snapshot?.createdAt ?? null),
                    snapshot
                        ? snapshot.createdAt >= row.createdAt &&
                          snapshot.createdAt < (outcome.endedAt ?? asOf)
                        : null,
                    row.unansweredTicketsAtCreation,
                    row.staffCapacityAtCreation,
                    snapshot ? JSON.stringify(snapshot.factorDetails) : null,
                ]),
            );
        }
    }

    return lines.join('\n') + '\n';
}
