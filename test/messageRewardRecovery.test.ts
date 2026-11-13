import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('a listener dying inside or after the reward transaction leaves exactly one credit and check-in', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'snoojote-reward-crash-'));
    const root = fileURLToPath(new URL('../', import.meta.url));
    const moduleUrl = (path: string) =>
        JSON.stringify(new URL('../src/' + path, import.meta.url).href);
    mkdirSync(join(folder, 'data'));
    mkdirSync(join(folder, 'config'));
    copyFileSync(
        join(root, 'config/bot.config.example.json'),
        join(folder, 'config/bot.config.json'),
    );
    const database = new Database(join(folder, 'data/database.sqlite'));
    try {
        for (const file of readdirSync(join(root, 'drizzle'))
            .filter((p) => p.endsWith('.sql'))
            .sort())
            database.exec(readFileSync(join(root, 'drizzle', file), 'utf8'));
        const run = (phase: string) =>
            Bun.spawn(
                [
                    process.execPath,
                    '-e',
                    `
            const {applyMessage}=await import(${moduleUrl('features/economy/events/messageCreate.ts')});
            const {default:streaks}=await import(${moduleUrl('features/streaks/services/StreakService.ts')});
            const {config}=await import(${moduleUrl('config.ts')});
            config.channels.streaks='reward-test';
            config.economy.messageRewards.min=config.economy.messageRewards.max=5;
            if(process.env.PHASE==='during') {
                const record=streaks.recordCheckIn.bind(streaks);
                streaks.recordCheckIn=(...args)=>{record(...args);process.exit(73);};
            }
            applyMessage({id:'shared',guildId:'guild',channelId:'reward-test',createdAt:new Date(1700000000000),
                content:'Spaincraft',author:{id:'member',bot:false},client:{channels:{cache:{filter:()=>new Map()}}}});
            if(process.env.PHASE==='after') process.exit(74);
        `,
                ],
                {
                    cwd: folder,
                    env: { ...process.env, NODE_ENV: 'development', PHASE: phase },
                    stdout: 'ignore',
                    stderr: 'inherit',
                },
            ).exited;
        expect(await run('during')).toBe(73);
        expect(database.query('SELECT count(*) AS n FROM message_reward_receipts').get()).toEqual({
            n: 0,
        });
        expect(database.query('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
        expect(await Promise.all([run('after'), run('replay')])).toEqual([74, 0]);
        expect(database.query('SELECT points FROM users').all()).toEqual([{ points: 5 }]);
        expect(database.query('SELECT streak FROM streaks').all()).toEqual([{ streak: 1 }]);
        expect(database.query('SELECT count(*) AS n FROM message_reward_receipts').get()).toEqual({
            n: 1,
        });
    } finally {
        database.close();
        rmSync(folder, { recursive: true, force: true });
    }
}, 30_000);
