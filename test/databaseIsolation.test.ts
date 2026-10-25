import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { sqlite, configureSqlite } from '../src/database/db.js';

describe('test database isolation and migrations', () => {
    test('known vulnerable SQLite engines cannot enable WAL', () => {
        const database = new Database(':memory:');
        try {
            database.function('sqlite_version', () => '3.51.2');
            expect(() => configureSqlite(database)).toThrow('WAL-reset bug');
        } finally {
            database.close();
        }
    });
    test('file databases use WAL and full durability with a bounded busy timeout', () => {
        const folder = mkdtempSync(path.join(tmpdir(), 'snoojote-wal-'));
        const database = new Database(path.join(folder, 'database.sqlite'));
        try {
            configureSqlite(database);
            expect(
                database.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()!
                    .journal_mode,
            ).toBe('wal');
            expect(
                database.query<{ synchronous: number }, []>('PRAGMA synchronous').get()!
                    .synchronous,
            ).toBe(2);
            expect(
                database.query<{ timeout: number }, []>('PRAGMA busy_timeout').get()!.timeout,
            ).toBe(1000);
        } finally {
            database.close();
            rmSync(folder, { recursive: true, force: true });
        }
    });
    test('the application database is in memory and has the actual migrated schema', () => {
        expect(sqlite.query<{ file: string }, []>('PRAGMA database_list').get()!.file).toBe('');
        const columns = sqlite
            .query<{ name: string }, []>('PRAGMA table_info(tickets)')
            .all()
            .map((row) => row.name);
        expect(columns).toContain('unanswered_tickets_at_creation');
        expect(columns).toContain('guild_id');
        expect(
            sqlite
                .query(
                    "SELECT name FROM sqlite_master WHERE name = 'shop_purchase_pending_user_idx'",
                )
                .get(),
        ).not.toBeNull();
        expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
    });

    test('a test import cannot touch an existing application database, even with production env inherited', () => {
        const folder = mkdtempSync(path.join(tmpdir(), 'snoojote-isolation-'));
        try {
            mkdirSync(path.join(folder, 'data'));
            const target = path.join(folder, 'data', 'database.sqlite');
            const live = new Database(target);
            live.exec(
                "CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('untouched')",
            );
            live.close();
            const before = readFileSync(target);
            const root = fileURLToPath(new URL('../', import.meta.url));
            const result = Bun.spawnSync(
                [
                    process.execPath,
                    '--preload',
                    path.join(root, 'test/setup.ts'),
                    '-e',
                    `const { sqlite } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'src/database/db.ts')).href)}); if (sqlite.query('PRAGMA database_list').get().file !== '') process.exit(1);`,
                ],
                { cwd: folder, env: { ...process.env, NODE_ENV: 'production' } },
            );
            expect(result.exitCode).toBe(0);
            expect(readFileSync(target)).toEqual(before);
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    });

    test('the new migration preserves existing balances and tickets', () => {
        const database = new Database(':memory:');
        try {
            database.exec('PRAGMA foreign_keys = ON');
            const directory = fileURLToPath(new URL('../drizzle/', import.meta.url));
            const files = readdirSync(directory)
                .filter((file) => file.endsWith('.sql'))
                .sort();
            for (const file of files.filter((file) => Number(file.slice(0, 4)) < 10))
                database.exec(readFileSync(path.join(directory, file), 'utf8'));
            database.exec(
                "INSERT INTO users (user_id, points) VALUES ('existing', 123); INSERT INTO tickets (channel_id, user_id) VALUES ('old-channel', 'existing')",
            );
            database.exec(`INSERT INTO shop_items (id, name, description, price, type, value) VALUES (1, 'legacy', 'legacy', 1, 'COLLECTIBLE', 'test');
                INSERT INTO user_inventory (user_id, item_id, acquired_at) VALUES ('existing', 1, '2025-01-02 03:04:05');`);
            for (const file of files.filter((file) => Number(file.slice(0, 4)) >= 10))
                database.exec(readFileSync(path.join(directory, file), 'utf8'));
            expect(
                database
                    .query<{ acquired_at: number }, []>('SELECT acquired_at FROM user_inventory')
                    .get()!.acquired_at,
            ).toBe(Date.parse('2025-01-02T03:04:05Z') / 1000);
            expect(
                database
                    .query(
                        "SELECT name FROM sqlite_master WHERE name IN ('economy_transaction_locks', 'shop_purchase_locks')",
                    )
                    .all(),
            ).toEqual([]);
            expect(() =>
                database.exec("UPDATE users SET points = -1 WHERE user_id = 'existing'"),
            ).toThrow();
            expect(
                database
                    .query<{ points: number }, []>(
                        "SELECT points FROM users WHERE user_id = 'existing'",
                    )
                    .get()!.points,
            ).toBe(123);
            expect(
                database.query<{ channel_id: string }, []>('SELECT channel_id FROM tickets').get()!
                    .channel_id,
            ).toBe('old-channel');
            expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
        } finally {
            database.close();
        }
    });
});
