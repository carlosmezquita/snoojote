interface RateLimitData {
    counter: number;
    firstSeen: number;
}

export class RateLimitService {
    private limits = new Map<string, RateLimitData>();
    private cooldownSecs: number;
    private cleanupInterval: NodeJS.Timeout;

    constructor(cooldownSecs: number = 60) {
        this.cooldownSecs = cooldownSecs;

        // Cleanup interval to remove expired entries every 30 seconds
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const expirationTime = this.cooldownSecs * 1000;

            for (const [key, data] of this.limits.entries()) {
                if (now - data.firstSeen > expirationTime) {
                    this.limits.delete(key);
                }
            }
        }, 30000);
    }

    /**
     * Checks if a user is rate limited.
     * @param key Unique key for the user (e.g., user ID)
     * @returns Current counter value
     */
    check(key: string): number {
        const now = Date.now();
        const data = this.limits.get(key);

        if (!data) {
            this.limits.set(key, { counter: 1, firstSeen: now });
            return 1;
        }

        // If the entry exists but has expired (edge case if interval hasn't run yet), reset it
        if (now - data.firstSeen > this.cooldownSecs * 1000) {
            this.limits.set(key, { counter: 1, firstSeen: now });
            return 1;
        }

        data.counter++;
        return data.counter;
    }

    /**
     * Resets the rate limit for a specific key.
     * @param key Unique key for the user
     */
    reset(key: string): void {
        this.limits.delete(key);
    }

    /**
     * Stops the cleanup interval. Call this when the service is no longer needed.
     */
    dispose(): void {
        clearInterval(this.cleanupInterval);
    }
}
