import { getSpainDateKey } from '../../streaks/services/streakRules.js';
const MINUTE_MS = 60_000;
export function datedMinutes(channelId: string, startedAt: number, now: number) {
    const minutes = Math.max(0, Math.floor((now - startedAt) / MINUTE_MS));
    const lastCompletion = startedAt + minutes * MINUTE_MS;
    const slices: { channelId: string; minutes: number; earnedAt: Date }[] = [];
    let completion = startedAt + MINUTE_MS;
    while (completion <= lastCompletion) {
        const key = getSpainDateKey(new Date(completion));
        let low = completion;
        let high = completion + 30 * 60 * MINUTE_MS;
        // Find the next local calendar boundary, including 23/25-hour DST days.
        while (low + 1 < high) {
            const midpoint = Math.floor((low + high) / 2);
            if (getSpainDateKey(new Date(midpoint)) === key) low = midpoint;
            else high = midpoint;
        }
        const count = Math.floor((Math.min(lastCompletion, high - 1) - completion) / MINUTE_MS) + 1;
        slices.push({
            channelId,
            minutes: count,
            earnedAt: new Date(completion),
        });
        completion += count * MINUTE_MS;
    }
    return { slices, lastCompletion };
}
