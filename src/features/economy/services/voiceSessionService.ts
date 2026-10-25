interface VoiceSession {
    channelId: string;
    startedAt: number;
}
import { getSpainDateKey } from '../../streaks/services/streakRules.js';

const MINUTE_MS = 60 * 1000;

export class VoiceSessionService {
    private readonly sessions = new Map<string, VoiceSession>();

    start(userId: string, channelId: string, now: number = Date.now()): void {
        this.sessions.set(userId, { channelId, startedAt: now });
    }

    stop(userId: string, now: number = Date.now()): { channelId: string; minutes: number } | null {
        const session = this.sessions.get(userId);
        if (!session) return null;

        this.sessions.delete(userId);

        return {
            channelId: session.channelId,
            minutes: this.calculateWholeMinutes(session.startedAt, now),
        };
    }

    switchChannel(
        userId: string,
        channelId: string,
        now: number = Date.now(),
    ): { channelId: string; minutes: number } | null {
        const elapsed = this.stop(userId, now);
        this.start(userId, channelId, now);
        return elapsed;
    }

    collectElapsed(
        userId: string,
        now: number = Date.now(),
    ): { channelId: string; minutes: number } | null {
        const session = this.sessions.get(userId);
        if (!session) return null;

        const minutes = this.calculateWholeMinutes(session.startedAt, now);
        if (minutes <= 0) return { channelId: session.channelId, minutes: 0 };

        session.startedAt += minutes * MINUTE_MS;
        return { channelId: session.channelId, minutes };
    }

    getSession(userId: string): VoiceSession | undefined {
        return this.sessions.get(userId);
    }

    collectDated(
        userId: string,
        now = Date.now(),
        stop = false,
    ): { channelId: string; minutes: number; earnedAt: Date }[] {
        const session = this.sessions.get(userId);
        if (!session) return [];
        const minutes = this.calculateWholeMinutes(session.startedAt, now);
        const lastCompletion = session.startedAt + minutes * MINUTE_MS;
        const slices: { channelId: string; minutes: number; earnedAt: Date }[] = [];
        let completion = session.startedAt + MINUTE_MS;
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
            const count =
                Math.floor((Math.min(lastCompletion, high - 1) - completion) / MINUTE_MS) + 1;
            slices.push({
                channelId: session.channelId,
                minutes: count,
                earnedAt: new Date(completion),
            });
            completion += count * MINUTE_MS;
        }
        session.startedAt = lastCompletion;
        if (stop) this.sessions.delete(userId);
        return slices;
    }

    private calculateWholeMinutes(startedAt: number, now: number): number {
        return Math.max(0, Math.floor((now - startedAt) / MINUTE_MS));
    }
}

export default new VoiceSessionService();
