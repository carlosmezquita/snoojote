import { asc, isNotNull } from 'drizzle-orm';
import db from '../database/db.js';
import { tickets } from '../database/schema.js';
import {
    type StaffResponseProfile,
    type TicketResponseData,
    estimateWaitTime,
    getTimeBlock,
} from '../features/tickets/services/waitTimeEstimator.js';

const ESTIMATION_TIME_ZONE = 'Europe/Madrid';

const rows = await db
    .select({
        id: tickets.id,
        createdAt: tickets.createdAt,
        firstResponseAt: tickets.firstResponseAt,
        firstResponseBy: tickets.firstResponseBy,
        staffCapacityAtCreation: tickets.staffCapacityAtCreation,
        staffOnlineAtCreation: tickets.staffOnlineAtCreation,
        openTicketsAtCreation: tickets.openTicketsAtCreation,
    })
    .from(tickets)
    .where(isNotNull(tickets.firstResponseAt))
    .orderBy(asc(tickets.createdAt))
    .all();

type AnsweredTicket = (typeof rows)[number] & {
    createdAt: Date;
    firstResponseAt: Date;
};

const answeredTickets = rows.filter(
    (row): row is AnsweredTicket =>
        isFiniteDate(row.createdAt) &&
        row.firstResponseAt != null &&
        isFiniteDate(row.firstResponseAt) &&
        row.firstResponseAt.getTime() > row.createdAt.getTime(),
);

const results: { id: number; predictedMs: number; actualMs: number; errorMs: number }[] = [];

for (let index = 0; index < answeredTickets.length; index += 1) {
    const ticket = answeredTickets[index];
    const priorTickets = answeredTickets.slice(0, index);

    if (priorTickets.length === 0) continue;

    const now = ticket.createdAt;
    const recentTickets = toTicketResponseData(priorTickets.slice(-20).reverse());
    const allTickets = toTicketResponseData(priorTickets);
    const temporalTickets = toTemporalTickets(priorTickets, now);
    const staffProfiles = buildHistoricalStaffProfiles(priorTickets, now);
    const queueLength = Math.max(ticket.openTicketsAtCreation ?? 0, 0);

    const estimate = estimateWaitTime({
        recentTickets,
        temporalTickets,
        allTickets,
        staffProfiles,
        now,
        queueLength,
        activeStaff: ticket.staffCapacityAtCreation ?? ticket.staffOnlineAtCreation ?? 0,
    });

    const actualMs = ticket.firstResponseAt.getTime() - ticket.createdAt.getTime();
    results.push({
        id: ticket.id,
        predictedMs: estimate.estimatedMs,
        actualMs,
        errorMs: estimate.estimatedMs - actualMs,
    });
}

if (results.length === 0) {
    console.log('No answered tickets with prior history were available for backtesting.');
    process.exit(0);
}

const absoluteErrors = results.map((result) => Math.abs(result.errorMs));
const medianAbsoluteErrorMs = median(absoluteErrors);
const meanAbsoluteErrorMs =
    absoluteErrors.reduce((total, value) => total + value, 0) / absoluteErrors.length;
const overEstimateRate =
    results.filter((result) => result.errorMs > 0).length / Math.max(results.length, 1);
const underEstimateRate =
    results.filter((result) => result.errorMs < 0).length / Math.max(results.length, 1);

console.log(
    [
        `Backtested tickets: ${results.length}`,
        `Median absolute error: ${formatMinutes(medianAbsoluteErrorMs)}`,
        `Mean absolute error: ${formatMinutes(meanAbsoluteErrorMs)}`,
        `Over-estimate rate: ${(overEstimateRate * 100).toFixed(1)}%`,
        `Under-estimate rate: ${(underEstimateRate * 100).toFixed(1)}%`,
    ].join('\n'),
);

function toTicketResponseData(source: AnsweredTicket[]): TicketResponseData[] {
    return source.map((ticket) => ({
        createdAt: ticket.createdAt,
        firstResponseAt: ticket.firstResponseAt,
        staffCapacityAtCreation: ticket.staffCapacityAtCreation,
        openTicketsAtCreation: ticket.openTicketsAtCreation,
    }));
}

function toTemporalTickets(source: AnsweredTicket[], now: Date): TicketResponseData[] {
    const sixtyDaysAgo = now.getTime() - 60 * 24 * 60 * 60 * 1000;
    const nowParts = getTimeZoneParts(now);
    if (!nowParts) return [];

    return toTicketResponseData(
        source.filter((ticket) => {
            if (ticket.createdAt.getTime() < sixtyDaysAgo) return false;
            const parts = getTimeZoneParts(ticket.createdAt);
            return (
                parts?.weekday === nowParts.weekday && getTimeBlock(parts.hour) === nowParts.block
            );
        }),
    );
}

function buildHistoricalStaffProfiles(source: AnsweredTicket[], now: Date): StaffResponseProfile[] {
    const byStaff = new Map<
        string,
        { samples: { occurredAt: Date; responseTimeMs: number }[]; recentActivityCount: number }
    >();
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

    for (const ticket of source) {
        if (!ticket.firstResponseBy) continue;

        const responseTimeMs = ticket.firstResponseAt.getTime() - ticket.createdAt.getTime();
        const existing = byStaff.get(ticket.firstResponseBy);
        const recentActivityCount =
            (existing?.recentActivityCount ?? 0) +
            (ticket.firstResponseAt.getTime() >= sevenDaysAgo ? 1 : 0);

        byStaff.set(ticket.firstResponseBy, {
            samples: [
                ...(existing?.samples ?? []),
                { occurredAt: ticket.firstResponseAt, responseTimeMs },
            ],
            recentActivityCount,
        });
    }

    return [...byStaff.entries()].map(([staffId, sample]) => ({
        staffId,
        status: 'online',
        recentActivityCount: sample.recentActivityCount,
        firstResponseSamples: sample.samples,
    }));
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatMinutes(ms: number): string {
    return `${(ms / 60_000).toFixed(1)} minutes`;
}

function isFiniteDate(date: Date | null | undefined): date is Date {
    return date instanceof Date && Number.isFinite(date.getTime());
}

function getTimeZoneParts(date: Date): { weekday: number; hour: number; block: number } | null {
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
    const hour = Number(parts.hour);

    return {
        weekday: weekdays.indexOf(parts.weekday),
        hour,
        block: getTimeBlock(hour),
    };
}
