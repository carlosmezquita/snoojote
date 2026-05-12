import { config } from '../../../config.js';

export const STREAK_TIME_ZONE = 'Europe/Madrid';
export const STREAK_GRACE_PERIOD_MS = config.streaks.gracePeriodHours * 60 * 60 * 1000;
export const DAILY_REWARD_BASE = config.economy.dailyReward.base;
export const DAILY_REWARD_PER_STREAK_DAY = config.economy.dailyReward.perStreakDay;
export const DAILY_REWARD_MAX = config.economy.dailyReward.max;
export const MILESTONE_BONUSES: Record<number, number> = Object.fromEntries(
    Object.entries(config.economy.milestoneBonuses).map(([days, bonus]) => [Number(days), bonus]),
);

export function getSpainDateKey(date: Date): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: STREAK_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    const parts = Object.fromEntries(
        formatter
            .formatToParts(date)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]),
    ) as { year: string; month: string; day: string };

    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isConsecutiveDay(
    lastDateKey: string | null | undefined,
    todayDateKey: string,
): boolean {
    if (!lastDateKey) return false;

    // Parse YYYY-MM-DD keys into Date objects at midnight UTC for consistent diffing
    const last = new Date(`${lastDateKey}T00:00:00Z`);
    const today = new Date(`${todayDateKey}T00:00:00Z`);

    const diffMs = today.getTime() - last.getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    return diffMs === oneDayMs;
}

export function isWithinGracePeriod(lastStreakAt: Date | null | undefined, now: Date): boolean {
    if (!lastStreakAt) return false;
    return now.getTime() - lastStreakAt.getTime() <= STREAK_GRACE_PERIOD_MS;
}

export function getDailyReward(streakDays: number): number {
    return Math.min(
        DAILY_REWARD_MAX,
        DAILY_REWARD_BASE + Math.max(0, streakDays) * DAILY_REWARD_PER_STREAK_DAY,
    );
}

export function getNewMilestones(streakDays: number, claimedMilestones: number[]): number[] {
    const claimed = new Set(claimedMilestones);
    return Object.keys(MILESTONE_BONUSES)
        .map(Number)
        .filter((milestone) => streakDays >= milestone && !claimed.has(milestone))
        .sort((a, b) => a - b);
}
