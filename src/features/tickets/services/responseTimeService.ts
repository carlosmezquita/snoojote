import { Guild } from 'discord.js';
import db from '../../../database/db.js';
import { tickets } from '../../../database/schema.js';
import { desc, isNotNull, eq, and } from 'drizzle-orm';
import { config } from '../../../config.js';

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
     * Calculates the estimated wait time for a new ticket.
     * Formula: Average Wait Time * (Total Staff / (Online Staff + 1))
     */
    async getEstimatedWaitTime(guild: Guild): Promise<string> {
        // 1. Calculate average wait time from last 20 tickets
        const recentTickets = await db.select({
            createdAt: tickets.createdAt,
            firstResponseAt: tickets.firstResponseAt
        })
            .from(tickets)
            .where(isNotNull(tickets.firstResponseAt))
            .orderBy(desc(tickets.createdAt))
            .limit(20)
            .all();

        if (recentTickets.length === 0) {
            return "Unknown"; // Not enough data
        }

        let totalWaitTime = 0;
        for (const ticket of recentTickets) {
            if (ticket.firstResponseAt && ticket.createdAt) {
                totalWaitTime += ticket.firstResponseAt.getTime() - ticket.createdAt.getTime();
            }
        }

        const avgWaitTimeMs = totalWaitTime / recentTickets.length;

        // 2. Count available staff members
        const supportRoleId = config.roles.support;
        if (!supportRoleId) {
            return this.formatDuration(avgWaitTimeMs); // Fallback if no role configured
        }

        const supportRole = guild.roles.cache.get(supportRoleId);
        if (!supportRole) {
            return this.formatDuration(avgWaitTimeMs);
        }

        // Fetch members to ensure cache is populated (crucial for accurate online count)
        // Note: This might be expensive on very large servers, but necessary.
        // For now, we assume members are reasonably cached or we rely on what's there.
        // Better approach: use guild.members.fetch() if needed, but let's try cache first.

        const totalStaff = supportRole.members.size;
        const onlineStaff = supportRole.members.filter(member =>
            member.presence?.status === 'online' ||
            member.presence?.status === 'dnd' ||
            member.presence?.status === 'idle'
        ).size;

        // User requested to discard idle/busy, but standard practice usually includes them as "online" vs "offline".
        // "we should only count available staff with role staff role. (discard idle, busy etc..)"
        // OK, user specifically said discard idle, busy. So only 'online'.

        const strictlyOnlineStaff = supportRole.members.filter(member =>
            member.presence?.status === 'online'
        ).size;

        // Avoid division by zero
        const effectiveStaffCount = strictlyOnlineStaff + 1;

        // Adjust estimate based on staff availability
        // If many staff are online, time should be lower.
        // If few staff are online, time should be higher.
        // However, the formula `Avg * (Total / Online)` implies:
        // If Online is low, factor is high -> Time increases. Correct.
        // If Online is high (close to Total), factor is ~1 -> Time is Avg. Correct.

        // If totalStaff is 10, and 1 is online. Factor = 10 / 2 = 5. Estimate = 5 * Avg.
        // If totalStaff is 10, and 10 are online. Factor = 10 / 11 = 0.9. Estimate = 0.9 * Avg.

        // Wait, if 0 staff are online, effective is 1. Factor = Total / 1.

        let multiplier = 1;
        if (totalStaff > 0) {
            multiplier = totalStaff / effectiveStaffCount;
        }

        const estimatedMs = avgWaitTimeMs * multiplier;

        return this.formatDuration(estimatedMs);
    }

    private formatDuration(ms: number): string {
        const minutes = Math.ceil(ms / (1000 * 60));
        if (minutes < 60) {
            return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        }

        const hours = Math.ceil(minutes / 60);
        return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
}

export default new ResponseTimeService();
