import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import path from 'path';
import * as schema from './schema.js';

const dbPath = path.join(process.cwd(), 'data', 'database.sqlite');
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

export default db;
