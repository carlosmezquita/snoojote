import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createLinkJournal,
    type SpamActions,
} from '../src/features/moderation/services/linkSpamJournal.js';

const migration = readFileSync(
    new URL('../drizzle/0014_link_spam_journal.sql', import.meta.url),
    'utf8',
);
const event = (messageId: string, observedAt: number) => ({
    messageId,
    observedAt,
    userId: 'member',
    guildId: 'guild',
    channelId: 'channel',
});
function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'snoojote-spam-'));
    const path = join(dir, 'journal.sqlite');
    const first = new Database(path);
    first.exec(migration);
    const second = new Database(path);
    return {
        path,
        first,
        second,
        close() {
            first.close();
            second.close();
            rmSync(dir, { recursive: true, force: true });
        },
    };
}
function actions(calls: string[], banned = true): SpamActions {
    const record = (key: string) => async () => {
        calls.push(key);
    };
    return {
        remove: record('remove'),
        dm: record('dm'),
        alert: record('alert'),
        ban: record('ban'),
        banLog: record('banLog'),
        isBanned: async () => banned,
        failed: (action) => {
            calls.push(action);
        },
    };
}

test('two connections hand off a burst; overlapping deliveries spend one count and one sanction', async () => {
    const fixture = setup();
    try {
        const old = createLinkJournal(fixture.first),
            next = createLinkJournal(fixture.second);
        const now = Date.now();
        const calls: string[] = [];
        for (let i = 1; i <= 5; i++) {
            const input = event(String(i), now + i);
            const primary = i < 3 ? old : next;
            expect(primary.recordLink(input)).toBe(i);
            expect(old.recordLink(input)).toBe(i);
            await Promise.all([
                primary.enforceLink(input.messageId, i, actions(calls)),
                old.enforceLink(input.messageId, i, actions(calls)),
            ]);
        }
        expect(calls.filter((x) => x === 'ban')).toHaveLength(1);
        expect(calls.filter((x) => x === 'remove')).toHaveLength(4);
        expect(calls.filter((x) => x === 'dm')).toHaveLength(3);
        expect(next.recordLink(event('new', now + 60002))).toBe(1);
    } finally {
        fixture.close();
    }
});

for (const accepted of [true, false]) {
    test(`process death at ban boundary (accepted=${accepted}) never issues a second sanction`, async () => {
        const fixture = setup();
        try {
            const journal = createLinkJournal(fixture.first);
            for (let i = 1; i <= 4; i++) journal.recordLink(event(String(i), Date.now()));
            fixture.first.exec('CREATE TABLE discord_bans(user_id TEXT PRIMARY KEY)');
            const child = Bun.spawnSync(
                [
                    process.execPath,
                    '-e',
                    `
                import {Database} from 'bun:sqlite';
                import {createLinkJournal} from './src/features/moderation/services/linkSpamJournal.ts';
                const db=new Database(process.env.TEST_LINK_DB);
                const noop=async()=>{};
                await createLinkJournal(db).enforceLink('4',4,{
                    remove:noop,dm:noop,alert:noop,banLog:noop,failed:noop,isBanned:async()=>false,
                    ban:async()=>{ if(process.env.TEST_ACCEPT==='yes') db.run("INSERT INTO discord_bans VALUES ('member')"); process.exit(73); }
                });`,
                ],
                {
                    env: {
                        ...process.env,
                        NODE_ENV: 'test',
                        TEST_LINK_DB: fixture.path,
                        TEST_ACCEPT: accepted ? 'yes' : 'no',
                    },
                },
            );
            expect(child.exitCode).toBe(73);
            const calls: string[] = [];
            const remote = fixture.second.query('SELECT * FROM discord_bans').all();
            const replacement = createLinkJournal(fixture.second);
            for (let i = 0; i < 2; i++)
                await replacement.enforceLink('4', 4, actions(calls, remote.length === 1), true);
            expect(calls).not.toContain('ban');
            expect(calls).not.toContain('dm');
            expect(
                fixture.second
                    .query("SELECT done FROM link_spam_events WHERE message_id='4'")
                    .get(),
            ).toEqual({ done: accepted ? 1 : 2 });
            expect(calls.filter((x) => x === 'banLog')).toHaveLength(accepted ? 1 : 0);
        } finally {
            fixture.close();
        }
    });
}
