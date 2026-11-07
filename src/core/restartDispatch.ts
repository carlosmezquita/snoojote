import { sqlite } from '../database/db.js';
import logger from '../utils/logger.js';
export type Receiver = 'primary' | 'standby';
export const receiver: Receiver = process.env.SNOOJOTE_LINK_GUARD === '1' ? 'standby' : 'primary';
let stopping = false;
const drained = (who: Receiver) =>
    (who === receiver && stopping) ||
    !!sqlite.query('SELECT 1 FROM gateway_drain WHERE owner=?').get(who);
export function initializeDispatch(who = receiver) {
    // systemd runs exactly one process per unit. Its predecessor is gone.
    sqlite.run('UPDATE gateway_work SET finished=1 WHERE owner=? AND finished=0', [who]);
    const prune = () =>
        sqlite.run('DELETE FROM gateway_work WHERE finished=1 AND started<?', [
            Date.now() - 7 * 86400000,
        ]);
    prune();
    setInterval(prune, 3600000).unref();
}
export function isWorking(resource: string) {
    return !!sqlite
        .query('SELECT 1 FROM gateway_work WHERE resource=? AND finished=0 LIMIT 1')
        .get(resource);
}
interface DispatchOptions {
    who?: Receiver;
    followup?: boolean;
    resource?: string;
    busy?: () => unknown;
    ai?: { cooldownMs: number; capacity: number };
}
export async function serveOnce(key: string, work: () => unknown, options: DispatchOptions = {}) {
    const who = options.who ?? receiver;
    if (!options.followup && who === 'standby' && !drained('primary'))
        await new Promise((r) => setTimeout(r, 350));
    const acquire = sqlite.transaction(() => {
        if (!options.followup && drained(who)) return 'drained';
        if (
            !sqlite.run(
                'INSERT INTO gateway_work(key,owner,started) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING',
                [key, who, Date.now()],
            ).changes
        )
            return 'skip';
        if (options.resource) {
            if (isWorking(options.resource)) return 'busy';
            if (options.ai) {
                const recent = sqlite
                    .query('SELECT 1 FROM gateway_work WHERE resource=? AND started>? LIMIT 1')
                    .get(options.resource, Date.now() - options.ai.cooldownMs);
                const active = sqlite
                    .query<{ n: number }, []>(
                        "SELECT COUNT(*) AS n FROM gateway_work WHERE resource LIKE 'ai:%' AND finished=0",
                    )
                    .get();
                if (recent || (active?.n ?? 0) >= options.ai.capacity) return 'busy';
            }
            sqlite.run('UPDATE gateway_work SET resource=? WHERE key=?', [options.resource, key]);
        }
        return 'run';
    }).immediate;
    let claim = acquire();
    // The two Gateway connections may deliver on different sides of the
    // routing switch. Give the newly active owner one more chance to claim.
    if (claim === 'drained') {
        await new Promise((r) => setTimeout(r, 450));
        claim = acquire();
    }
    if (claim === 'skip' || claim === 'drained') return;
    try {
        if (claim === 'busy') await options.busy?.();
        else await work();
    } finally {
        sqlite.run('UPDATE gateway_work SET finished=1 WHERE key=?', [key]);
    }
}
export function reportDispatchError(error: unknown) {
    logger.error('Gateway dispatch failed', { error });
}

export async function drainBeforeExit() {
    stopping = true;
    const until = Date.now() + 120000;
    while (
        sqlite
            .query('SELECT 1 FROM gateway_work WHERE owner=? AND finished=0 LIMIT 1')
            .get(receiver)
    ) {
        if (Date.now() >= until) {
            logger.error('Service shutdown timed out waiting for accepted gateway work', {
                receiver,
            });
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}
