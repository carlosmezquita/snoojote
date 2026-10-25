/** A synchronous reservation before async work. Full capacity fails closed. */
export class Cooldown {
    private readonly expires = new Map<string, number>();
    constructor(private readonly maximum = 10_000) {}

    acquire(key: string, ttlMs: number, now = Date.now()): boolean {
        if ((this.expires.get(key) ?? 0) > now) return false;
        if (this.expires.size >= this.maximum) {
            for (const [id, expiry] of this.expires) if (expiry <= now) this.expires.delete(id);
            if (this.expires.size >= this.maximum) return false;
        }
        this.expires.set(key, now + ttlMs);
        return true;
    }

    get size() {
        return this.expires.size;
    }
}
