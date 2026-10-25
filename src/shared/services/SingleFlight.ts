/** Share an in-flight request; remove successes and failures so retries remain possible. */
export class SingleFlight<K, V> {
    private readonly requests = new Map<K, Promise<V>>();
    run(key: K, work: () => Promise<V>): Promise<V> {
        const existing = this.requests.get(key);
        if (existing) return existing;
        const request = Promise.resolve().then(work);
        this.requests.set(key, request);
        const clear = () => {
            if (this.requests.get(key) === request) this.requests.delete(key);
        };
        void request.then(clear, clear);
        return request;
    }
}
