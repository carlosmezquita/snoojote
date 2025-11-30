interface RateLimitData {
    counter: number;
    firstSeen: number;
}

export class RateLimitService {
    private limits = new Map<string, RateLimitData>();
    private cooldownSecs: number;

    constructor(cooldownSecs: number = 60) {
        this.cooldownSecs = cooldownSecs;
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

            // Auto-cleanup
            setTimeout(() => {
                this.limits.delete(key);
            }, this.cooldownSecs * 1000);

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
}
