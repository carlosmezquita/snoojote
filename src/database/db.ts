import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import * as schema from './schema.js';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'database.sqlite');
const sqlite = new Database(dbPath);

// Enable Foreign Key support
sqlite.exec('PRAGMA foreign_keys = ON');

const db = drizzle({ client: sqlite, schema });

export default db;
