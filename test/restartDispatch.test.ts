import { afterEach, expect, spyOn, test } from 'bun:test';
import { sqlite } from '../src/database/db.js';
import { serveOnce, isWorking } from '../src/core/restartDispatch.js';
import { confirmPurchase } from '../src/features/economy/commands/buy.js';
import shop from '../src/features/economy/services/shopService.js';
import {
    queueReaction,
    flushStarboard,
} from '../src/features/starboard/services/starboardRefresh.js';
import { StarboardService } from '../src/features/starboard/services/StarboardService.js';
import { config } from '../src/config.js';
import {
    saveVerification,
    membershipKey,
    readVerification,
} from '../src/features/moderation/services/verificationJournal.js';
import { VerificationService } from '../src/features/moderation/services/VerificationService.js';
import { VerificationStateService } from '../src/features/moderation/services/VerificationStateService.js';

afterEach(() => {
    sqlite.run('DELETE FROM gateway_drain');
});
test('cutover drains accepted work, routes the next event to standby and suppresses replays', async () => {
    let finish!: () => void;
    const pending = serveOnce(
        'test:running',
        () =>
            new Promise<void>((r) => {
                finish = r;
            }),
        { resource: 'test:ticket' },
    );
    expect(isWorking('test:ticket')).toBe(true);
    sqlite.run("INSERT INTO gateway_drain VALUES ('primary')");
    const events: string[] = [];
    await serveOnce('test:busy', () => events.push('unexpected'), {
        who: 'standby',
        resource: 'test:ticket',
        busy: () => events.push('busy'),
    });
    await Promise.all(
        ['primary', 'standby'].map((who) =>
            serveOnce('test:once', () => events.push(who), { who: who as 'primary' | 'standby' }),
        ),
    );
    finish();
    await pending;
    expect(isWorking('test:ticket')).toBe(false);
    sqlite.run('DELETE FROM gateway_drain');
    await serveOnce('test:once', () => events.push('duplicate'));
    expect(events).toEqual(['busy', 'standby']);
});

test('a purchase confirmation survives handoff and permits one debit for its original buyer', async () => {
    sqlite.run('INSERT INTO shop_confirmations VALUES(?,?,?,?,?,?)', [
        'offer',
        'g',
        'buyer',
        'item',
        42,
        Date.now() + 60000,
    ]);
    const buy = spyOn(shop, 'buyItem').mockResolvedValue({ success: true, message: 'ok' });
    const button = (user: string) =>
        ({
            customId: 'confirm_buy:offer',
            guildId: 'g',
            user: { id: user },
            deferUpdate: async () => {},
            reply: async () => {},
            editReply: async () => {},
        }) as never;
    try {
        await confirmPurchase(button('other'));
        await Promise.all([confirmPurchase(button('buyer')), confirmPurchase(button('buyer'))]);
        expect(buy).toHaveBeenCalledTimes(1);
        expect(buy.mock.calls[0]?.slice(1)).toEqual(['item', 42]);
    } finally {
        buy.mockRestore();
    }
});

test('standby answers a persisted CAPTCHA once without a local verification session', async () => {
    let removes = 0;
    const guild = { id: 'dispatch-guild', channels: { fetch: async () => null } };
    const member = {
        id: 'dispatch-member',
        guild,
        joinedTimestamp: 1,
        roles: {
            remove: async () => {
                removes++;
            },
        },
    };
    const key = membershipKey(member as never);
    saveVerification(key, {
        guildId: guild.id,
        challengeId: 'persisted',
        answer: 'ABC',
        expiresAt: Date.now() + 60000,
        processing: false,
        attempts: 0,
        channelId: 'verify-channel',
        mainMsgId: 'm',
        warningMsgId: null,
        timeouts: [],
    });
    const interaction = {
        guild,
        guildId: guild.id,
        member,
        user: { id: member.id },
        channel: { id: 'verify-channel', name: 'verify-user', delete: async () => {} },
        channelId: 'verify-channel',
        inGuild: () => true,
        isButton: () => false,
        isModalSubmit: () => true,
        customId: 'verify_modal_persisted',
        fields: { getTextInputValue: () => 'ABC' },
        deferReply: async () => {},
        editReply: async () => {},
        reply: async () => {},
    };
    const client = { logger: { warn: () => {}, info: () => {}, error: () => {} }, emit: () => {} };
    const handle = () =>
        new VerificationService(new VerificationStateService()).handleInteraction(
            interaction as never,
            client as never,
        );
    await Promise.all([handle(), handle()]);
    expect(removes).toBe(1);
    expect(readVerification(key)?.status).toBe('completed');
});

test('duplicate reactions during restart coalesce; an intervening update survives publication', async () => {
    const reaction = {
        emoji: { name: config.starboard.emojis[0] },
        message: { id: 'restart-message', channelId: 'restart-channel', guildId: config.guildId },
    };
    const enqueue = () => queueReaction(reaction as never, { bot: false } as never);
    enqueue();
    enqueue();
    let publishes = 0;
    const update = spyOn(StarboardService, 'handleReactionUpdate').mockImplementation(async () => {
        if (++publishes === 1) enqueue();
    });
    const client = {
        channels: {
            fetch: async () => ({
                guildId: config.guildId,
                isTextBased: () => true,
                messages: { fetch: async () => ({}) },
            }),
        },
    };
    try {
        await flushStarboard(client as never);
        await flushStarboard(client as never);
        await flushStarboard(client as never);
        expect(publishes).toBe(2);
    } finally {
        update.mockRestore();
    }
});

test('cutover with Gateway delivery skew still runs the interaction once', async () => {
    sqlite.run("INSERT INTO gateway_drain VALUES ('standby')");
    const calls: string[] = [];
    const standby = serveOnce('test:skew', () => calls.push('standby'), { who: 'standby' });
    await new Promise((r) => setTimeout(r, 375));
    sqlite.transaction(() => {
        sqlite.run('DELETE FROM gateway_drain');
        sqlite.run("INSERT INTO gateway_drain VALUES ('primary')");
    })();
    await Promise.all([
        standby,
        serveOnce('test:skew', () => calls.push('primary'), { who: 'primary' }),
    ]);
    expect(calls).toEqual(['standby']);
});
