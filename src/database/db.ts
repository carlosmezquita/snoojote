import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import * as schema from './schema.js';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { fileURLToPath } from 'url';

// Test mode deliberately ignores application paths and never opens the live file.
const testing = process.env.NODE_ENV === 'test';
const dbPath = testing ? ':memory:' : path.join(process.cwd(), 'data', 'database.sqlite');
if (!testing) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const sqlite = new Database(dbPath);

// Enable Foreign Key support
export function configureSqlite(connection: Database): void {
    const version = connection
        .query<{ version: string }, []>('SELECT sqlite_version() AS version')
        .get()!.version;
    const [major, minor, patch] = version.split('.').map(Number);
    const patched =
        major! > 3 ||
        (major === 3 &&
            (minor! > 51 ||
                (minor === 51 && patch! >= 3) ||
                (minor === 50 && patch! >= 7) ||
                (minor === 44 && patch! >= 6)));
    if (!patched)
        throw new Error(
            `SQLite ${version} has the WAL-reset bug; upgrade Bun or the system SQLite library before starting.`,
        );
    connection.exec('PRAGMA foreign_keys = ON');
    connection.exec('PRAGMA busy_timeout = 1000');
    connection.exec('PRAGMA journal_mode = WAL');
    connection.exec('PRAGMA synchronous = FULL');
}
configureSqlite(sqlite);

const db = drizzle({ client: sqlite, schema });
export type AppDatabase = typeof db;

if (testing) {
    migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
}

export default db;
