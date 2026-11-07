import type { Client, VoiceState } from 'discord.js';
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('voice settlement survives process death on either side of commit and a replacement replay', async () => {
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
            const {VoiceObserver}=await import(${moduleUrl('features/economy/services/voiceLedger.ts')});
            const {default:economy}=await import(${moduleUrl('features/economy/services/economyService.ts')});
            const {config}=await import(${moduleUrl('config.ts')});
            config.economy.voiceRewards.perMinute=2;
            const {default:quests}=await import(${moduleUrl('features/economy/services/questService.ts')});
            quests.generateQuest=()=>({type:'VOICE_TIME',current:0,goal:10,description:'fixture',isCompleted:false});
            const observer=new VoiceObserver(), client={};
            const a={channelId:'a',sessionId:'s'},off={channelId:null,sessionId:null};
            const start=1700000000000;
            observer.observe('g','u',null,a,client,start);
            if(process.env.PHASE==='seed')process.exit(0);
            if(process.env.PHASE==='during'){
                const credit=economy.addCappedEarningSync.bind(economy);
                economy.addCappedEarningSync=(...args)=>{credit(...args);process.exit(73)};
            }
            for(let ms=15000;ms<=180000;ms+=15000) observer.observe('g','u',null,a,client,start+ms);
            observer.observe('g','u',a,off,client,start+185000);
            process.exit(74);
        `,
                ],
                {
                    cwd: folder,
                    env: { ...process.env, NODE_ENV: 'development', PHASE: phase },
                    stdout: 'ignore',
                    stderr: 'inherit',
                },
            ).exited;
        expect(await run('seed')).toBe(0);
        expect(await run('during')).toBe(73);
        expect(database.query('SELECT channel_id,cursor FROM voice_sessions').get()).toEqual({
            channel_id: 'a',
            cursor: 1700000000000,
        });
        expect(database.query('SELECT points FROM users').get()).toBeNull();
        expect(await run('after')).toBe(74);
        expect(database.query('SELECT channel_id,revision FROM voice_sessions').get()).toEqual({
            channel_id: null,
            revision: 2,
        });
        expect(database.query('SELECT points FROM users').get()).toEqual({ points: 6 });
        // A listener whose ordered stream still contains the old join and leave catches up.
        const replay = Bun.spawnSync(
            [
                process.execPath,
                '-e',
                `
          const {VoiceObserver}=await import(${moduleUrl('features/economy/services/voiceLedger.ts')});
          const o=new VoiceObserver(),a={channelId:'a',sessionId:'s'},off={channelId:null,sessionId:null};
          o.observe('g','u',off,a,{},1700000000000);
          o.observe('g','u',a,off,{},1700000185000);
        `,
            ],
            { cwd: folder, env: { ...process.env, NODE_ENV: 'development' } },
        );
        expect(replay.exitCode).toBe(0);
        expect(
            database
                .query("SELECT json_extract(daily_quest,'$.current') AS minutes FROM users")
                .get(),
        ).toEqual({ minutes: 3 });
        expect(database.query('SELECT points FROM users').get()).toEqual({ points: 6 });
    } finally {
        database.close();
        rmSync(folder, { recursive: true, force: true });
    }
}, 30000);

test('delayed standby moves and repeated leaves cannot settle an A-B-A sequence twice', async () => {
    const { VoiceObserver } = await import('../src/features/economy/services/voiceLedger.js');
    const { sqlite } = await import('../src/database/db.js');
    const { config } = await import('../src/config.js');
    const primary = new VoiceObserver(),
        standby = new VoiceObserver();
    const user = 'voice-reorder',
        start = 1700000000000;
    const a = { channelId: 'a', sessionId: 's' },
        b = { channelId: 'b', sessionId: 's' },
        off = { channelId: null, sessionId: null };
    const client = { channels: { cache: { filter: () => new Map() } } } as unknown as Client;
    primary.observe('g', user, off, a, client, start);
    standby.observe('g', user, off, a, client, start);
    primary.observe('g', user, null, a, client, start + 35000);
    primary.observe('g', user, a, b, client, start + 65000);
    primary.observe('g', user, b, a, client, start + 67000);
    standby.observe('g', user, a, b, client, start + 68000);
    standby.observe('g', user, b, a, client, start + 68001);
    standby.observe('g', user, null, a, client, start + 100000);
    standby.observe('g', user, a, off, client, start + 130000);
    primary.observe('g', user, a, off, client, start + 131000);
    expect(
        sqlite.query('SELECT revision,channel_id FROM voice_sessions WHERE user_id=?').get(user),
    ).toEqual({ revision: 4, channel_id: null });
    expect(sqlite.query('SELECT points FROM users WHERE user_id=?').get(user)).toEqual({
        points: 2 * Math.floor(config.economy.voiceRewards.perMinute),
    });
});

test('two collections followed by a leave pay only the next completed minute', async () => {
    const { VoiceObserver, collectVoice } =
        await import('../src/features/economy/services/voiceLedger.js');
    const { sqlite } = await import('../src/database/db.js');
    const { config } = await import('../src/config.js');
    const observer = new VoiceObserver(),
        user = 'voice-collect';
    const start = Date.now() - 95000,
        active = { channelId: 'a', sessionId: 's' },
        off = { channelId: null, sessionId: null };
    const client = { channels: { cache: { filter: () => new Map() } } } as unknown as Client;
    observer.observe('g', user, off, active, client, start);
    for (const elapsed of [30000, 60000, 90000])
        observer.observe('g', user, null, active, client, start + elapsed);
    const state = { ...active, id: user, guild: { id: 'g' }, client } as VoiceState;
    await Promise.all([collectVoice(state), collectVoice(state)]);
    expect(sqlite.query('SELECT cursor FROM voice_sessions WHERE user_id=?').get(user)).toEqual({
        cursor: start + 60000,
    });
    observer.observe('g', user, active, off, client, start + 125000);
    expect(sqlite.query('SELECT points FROM users WHERE user_id=?').get(user)).toEqual({
        points: 2 * Math.floor(config.economy.voiceRewards.perMinute),
    });
});
