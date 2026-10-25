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
sqlite.exec('PRAGMA foreign_keys = ON');

const db = drizzle({ client: sqlite, schema });
export type AppDatabase = typeof db;

if (testing) {
    migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
}

export default db;
