// This script must never open the application database or call Discord.
process.env.NODE_ENV = 'test';
const { sqlite } = await import('../database/db.js');
const { EconomyService } = await import('../features/economy/services/economyService.js');

const members = 3000;
const insert = sqlite.prepare('INSERT INTO users (user_id, points) VALUES (?, 100)');
sqlite.transaction(() => {
    for (let i = 0; i < members; i++) insert.run(`bench-${i}`);
})();
const economy = new EconomyService();
const started = performance.now();
const transfers = await Promise.all(
    Array.from({ length: members }, (_, i) =>
        economy.transfer(`bench-${i}`, `bench-${(i + 1) % members}`, 1),
    ),
);
const elapsed = performance.now() - started;
const balance = sqlite.query<{ total: number }, []>('SELECT SUM(points) AS total FROM users').get()!
    .total;
if (transfers.some((success) => !success) || balance !== members * 100)
    throw new Error('Benchmark violated a balance invariant');
console.log(
    JSON.stringify(
        {
            workload: 'synthetic SQLite economy; no Discord traffic',
            members,
            transfers: transfers.length,
            elapsedMs: Math.round(elapsed),
            transfersPerSecond: Math.round((members * 1000) / elapsed),
            conservedTotal: balance,
            database: sqlite.query('PRAGMA database_list').get(),
        },
        null,
        2,
    ),
);
sqlite.close();
