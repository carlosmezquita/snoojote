import sqlite3 from 'sqlite3';
import path from 'path';
import logger from '../utils/logger.js';

class Database {
    private db: sqlite3.Database;

    constructor() {
        const dbPath = path.join(process.cwd(), 'data', 'database.sqlite');
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                logger.error(`Could not connect to database: ${err.message}`);
            } else {
                logger.info('Connected to database');
                this.init();
            }
        });
    }

    private init() {
        this.db.serialize(() => {
            // Tickets table
            this.db.run(`CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT,
                user_id TEXT,
                status TEXT DEFAULT 'open',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Streaks table
            this.db.run(`CREATE TABLE IF NOT EXISTS streaks (
                user_id TEXT PRIMARY KEY,
                streak INTEGER DEFAULT 0,
                last_streak_date TEXT
            )`);

            // Users table (for economy/points)
            this.db.run(`CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                points INTEGER DEFAULT 0,
                xp INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1
            )`);
        });
    }

    public run(sql: string, params: any[] = []): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    public get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, result) => {
                if (err) reject(err);
                else resolve(result as T);
            });
        });
    }

    public all<T>(sql: string, params: any[] = []): Promise<T[]> {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows as T[]);
            });
        });
    }
}

export default new Database();
