import { describe, expect, test } from 'bun:test';
import { type Interaction } from 'discord.js';
import { type DiscordBot } from '../src/core/client.js';
import { VerificationService } from '../src/features/moderation/services/VerificationService.js';
import { VerificationStateService } from '../src/features/moderation/services/VerificationStateService.js';
import { type VerificationState } from '../src/features/moderation/types/verification.js';

async function fixture() {
    const store = new VerificationStateService();
    const state: VerificationState = {
        guildId: 'guild',
        channelId: 'channel',
        mainMsgId: 'message',
        warningMsgId: null,
        timeouts: [],
        attempts: 0,
        challengeId: '',
        answer: '',
        expiresAt: 10_000,
        processing: false,
    };
    let now = 1000;
    const service = new VerificationService(
        store,
        {
            generateCaptchaText: () => 'AB234',
            drawCaptchaImage: async () => Buffer.from('test image'),
        },
        () => now,
    );
    const payload = await service.generateChallengePayload('user', 3, state);
    store.set('user', state);
    const events: string[] = [];
    const client = {
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        emit: (event: string) => {
            events.push(event);
        },
    } as unknown as DiscordBot;
    const channel = {
        id: 'channel',
        guildId: 'guild',
        name: 'verify-user',
        isTextBased: () => true,
        messages: { fetch: async () => ({ edit: async () => {} }) },
        send: async () => ({ id: 'new-message' }),
        delete: async () => {
            events.push('deleted');
        },
    };
    const interaction = (overrides: Record<string, unknown> = {}) =>
        ({
            user: { id: 'user' },
            guildId: 'guild',
            channelId: 'channel',
            channel,
            guild: { channels: { fetch: async () => null } },
            customId: `verify_modal_${state.challengeId}`,
            member: {
                roles: {
                    remove: async () => {
                        events.push('role removed');
                    },
                },
            },
            fields: { getTextInputValue: () => 'ab234' },
            inGuild: () => true,
            isButton: () => false,
            isModalSubmit: () => true,
            isRepliable: () => true,
            reply: async () => {
                events.push('reply');
            },
            deferReply: async () => {
                events.push('defer');
            },
            editReply: async () => {
                events.push('edit');
            },
            showModal: async () => {
                events.push('modal');
            },
            deferUpdate: async () => {},
            followUp: async () => {},
            ...overrides,
        }) as unknown as Interaction;
    return {
        store,
        state,
        service,
        payload,
        events,
        client,
        interaction,
        expire: () => {
            now = 10_000;
        },
    };
}

describe('server-side verification challenges', () => {
    test('component and modal IDs contain only an opaque challenge ID', async () => {
        const f = await fixture();
        const button = f.payload.components[0].components[0].toJSON();
        if (!('custom_id' in button)) throw new Error('Expected a custom-ID button');
        expect(button.custom_id).toBe(`verify_btn_${f.state.challengeId}`);
        expect(button.custom_id).not.toContain('AB234');
        let modalId = '';
        await f.service.handleInteraction(
            f.interaction({
                isButton: () => true,
                isModalSubmit: () => false,
                customId: button.custom_id,
                showModal: async (modal: { data: { custom_id: string } }) => {
                    modalId = modal.data.custom_id;
                },
            }),
            f.client,
        );
        expect(modalId).toBe(`verify_modal_${f.state.challengeId}`);
        expect(modalId).not.toContain('AB234');
    });

    test('accepts the server-stored answer once and rejects replay', async () => {
        const f = await fixture();
        const submit = f.interaction();
        await f.service.handleInteraction(submit, f.client);
        await f.service.handleInteraction(submit, f.client);
        expect(f.events.filter((event) => event === 'role removed')).toHaveLength(1);
        expect(f.events.filter((event) => event === 'guildMemberVerified')).toHaveLength(1);
        expect(f.store.get('user', 'guild')).toBeUndefined();
        expect(f.events.indexOf('defer')).toBeLessThan(f.events.indexOf('role removed'));
    });

    for (const [label, overrides] of [
        ['another user', { user: { id: 'other' } }],
        ['another guild', { guildId: 'other-guild' }],
        ['another channel', { channelId: 'other-channel' }],
        ['an answer embedded in the custom ID', { customId: 'verify_modal_AB234' }],
    ] as const) {
        test(`rejects ${label} without deleting the channel or consuming an attempt`, async () => {
            const f = await fixture();
            await f.service.handleInteraction(f.interaction(overrides), f.client);
            expect(f.events).toEqual(['reply']);
            expect(f.state.attempts).toBe(0);
            expect(f.store.get('user', 'guild')).toBe(f.state);
        });
    }

    test('rejects an expired session', async () => {
        const f = await fixture();
        f.expire();
        await f.service.handleInteraction(f.interaction(), f.client);
        expect(f.events).toEqual(['reply']);
    });

    test('a wrong answer rotates the challenge and stale modals do not consume more attempts', async () => {
        const f = await fixture();
        const old = f.state.challengeId;
        const submit = f.interaction({ fields: { getTextInputValue: () => 'WRONG' } });
        await f.service.handleInteraction(submit, f.client);
        expect(f.state.attempts).toBe(1);
        expect(f.state.challengeId).not.toBe(old);
        await f.service.handleInteraction(submit, f.client);
        expect(f.state.attempts).toBe(1);
        expect(f.events).not.toContain('role removed');
    });

    test('concurrent valid submissions remove the role only once', async () => {
        const f = await fixture();
        await Promise.all([
            f.service.handleInteraction(f.interaction(), f.client),
            f.service.handleInteraction(f.interaction(), f.client),
        ]);
        expect(f.events.filter((event) => event === 'role removed')).toHaveLength(1);
    });

    test('a permission failure retains the session for a retry', async () => {
        const f = await fixture();
        await f.service.handleInteraction(
            f.interaction({
                member: {
                    roles: {
                        remove: async () => {
                            throw new Error('Missing permissions');
                        },
                    },
                },
            }),
            f.client,
        );
        expect(f.store.get('user', 'guild')).toBe(f.state);
        expect(f.state.processing).toBe(false);
        expect(f.events).not.toContain('guildMemberVerified');
        await f.service.handleInteraction(f.interaction(), f.client);
        expect(f.events).toContain('guildMemberVerified');
    });
});
