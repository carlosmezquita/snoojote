interface VoiceSession {
    channelId: string;
    startedAt: number;
}

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

    private calculateWholeMinutes(startedAt: number, now: number): number {
        return Math.max(0, Math.floor((now - startedAt) / MINUTE_MS));
    }
}

export default new VoiceSessionService();
