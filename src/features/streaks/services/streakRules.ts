export const STREAK_TIME_ZONE = 'Europe/Madrid';
export const STREAK_GRACE_PERIOD_MS = 36 * 60 * 60 * 1000;
export const DAILY_REWARD_BASE = 250;
export const DAILY_REWARD_PER_STREAK_DAY = 5;

export const MILESTONE_BONUSES: Record<number, number> = {
    7: 1_000,
    30: 5_000,
    100: 25_000,
    365: 100_000,
};

export function getSpainDateKey(date: Date): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: STREAK_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    const parts = Object.fromEntries(
        formatter.formatToParts(date)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
    ) as { year: string; month: string; day: string };

    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getDailyReward(streakDays: number): number {
    return DAILY_REWARD_BASE + Math.max(0, streakDays) * DAILY_REWARD_PER_STREAK_DAY;
}

export function isWithinGracePeriod(lastStreakAt: Date | null | undefined, now: Date): boolean {
    if (!lastStreakAt) return false;
    return now.getTime() - lastStreakAt.getTime() <= STREAK_GRACE_PERIOD_MS;
}

export function getNewMilestones(streakDays: number, claimedMilestones: number[]): number[] {
    const claimed = new Set(claimedMilestones);
    return Object.keys(MILESTONE_BONUSES)
        .map(Number)
        .filter(milestone => streakDays >= milestone && !claimed.has(milestone))
        .sort((a, b) => a - b);
}
