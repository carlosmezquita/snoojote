import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as schema from './schema.js';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'database.sqlite');
const sqlite = new Database(dbPath);

// Enable Foreign Key support
sqlite.pragma('foreign_keys = ON');

const db = drizzle(sqlite, { schema });

export default db;
