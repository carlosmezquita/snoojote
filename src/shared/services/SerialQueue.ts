/** Serialize mutations per resource without retaining completed keys. */
export class SerialQueue {
    private readonly tails = new Map<string, Promise<unknown>>();
    private pending = 0;
    constructor(private readonly maximum = 1000) {}

    async run<T>(key: string, work: () => Promise<T>): Promise<T> {
        if (this.pending >= this.maximum) throw new Error('Work queue capacity exceeded');
        this.pending++;
        const previous = this.tails.get(key) ?? Promise.resolve();
        const next = previous.catch(() => {}).then(work);
        this.tails.set(key, next);
        try {
            return await next;
        } finally {
            this.pending--;
            if (this.tails.get(key) === next) this.tails.delete(key);
        }
    }
    get size() {
        return this.pending;
    }
}
