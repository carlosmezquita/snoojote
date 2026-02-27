import { Guild } from 'discord.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { desc, isNotNull, eq, count } from 'drizzle-orm';
import { config } from '../../../config.js';
import {
    type HistoricalTicket,
    type EstimationContext,
    estimateWaitTimeMs,
    formatDuration,
} from './waitTimeEstimator.js';

export class ResponseTimeService {
    /**
     * Records the time of the first response to a ticket by a staff member.
     * Only updates if firstResponseAt is currently null.
     */
    async recordResponse(ticketId: number, timestamp: Date): Promise<void> {
        const ticket = await db.select().from(tickets).where(eq(tickets.id, ticketId)).get();

        if (ticket && !ticket.firstResponseAt) {
            await db.update(tickets)
                .set({ firstResponseAt: timestamp })
                .where(eq(tickets.id, ticketId));
        }
    }

    /**
     * Counts the number of currently online support staff members.
     */
    getOnlineStaffCount(guild: Guild): number {
        const supportRoleId = config.roles.support;
        if (!supportRoleId) return 0;

        const supportRole = guild.roles.cache.get(supportRoleId);
        if (!supportRole) return 0;

        return supportRole.members.filter(member =>
            member.presence?.status === 'online'
        ).size;
    }

    /**
     * Counts the number of currently open tickets.
     */
    async getOpenTicketCount(): Promise<number> {
        const result = await db.select({ value: count() })
            .from(tickets)
            .where(eq(tickets.status, 'open'))
            .get();

        return result?.value ?? 0;
    }

    /**
     * Calculates the estimated wait time for a new ticket using
     * kernel-based weighted estimation over historical data.
     *
     * Considers: hour of day, day of week, month/season, recency,
     * staff availability, and current queue depth.
     */
    async getEstimatedWaitTime(guild: Guild): Promise<string> {
        // 1. Fetch historical tickets with recorded response times.
        //    We use the last 200 responded tickets to give the kernel
        //    enough data across different time patterns.
        const historicalRows = await db.select({
            createdAt: tickets.createdAt,
            firstResponseAt: tickets.firstResponseAt,
            staffOnlineAtCreation: tickets.staffOnlineAtCreation,
            openTicketsAtCreation: tickets.openTicketsAtCreation,
        })
            .from(tickets)
            .where(isNotNull(tickets.firstResponseAt))
            .orderBy(desc(tickets.createdAt))
            .limit(200)
            .all();

        if (historicalRows.length === 0) {
            return 'Unknown';
        }

        // Map DB rows to the estimator's interface.
        const historicalTickets: HistoricalTicket[] = historicalRows
            .filter(r => r.firstResponseAt != null)
            .map(r => ({
                createdAt: r.createdAt,
                firstResponseAt: r.firstResponseAt!,
                staffOnlineAtCreation: r.staffOnlineAtCreation,
                openTicketsAtCreation: r.openTicketsAtCreation,
            }));

        // 2. Build current context.
        const onlineStaff = this.getOnlineStaffCount(guild);
        const openTickets = await this.getOpenTicketCount();

        const ctx: EstimationContext = {
            now: new Date(),
            onlineStaff,
            openTickets,
        };

        // 3. Compute estimate.
        const estimatedMs = estimateWaitTimeMs(historicalTickets, ctx);

        if (estimatedMs === null) {
            return 'Unknown';
        }

        return formatDuration(estimatedMs);
    }
}

export default new ResponseTimeService();
