import { describe, expect, test } from 'bun:test';
import { Events, GatewayIntentBits } from 'discord.js';
import { DiscordBot } from '../src/core/client.js';
import voiceRewards from '../src/features/economy/events/voiceStateUpdate.js';
import * as inviteCreate from '../src/features/moderation/events/inviteCreate.js';
import * as inviteDelete from '../src/features/moderation/events/inviteDelete.js';

describe('Discord subscriptions', () => {
    test('the client subscribes to the intents required by voice rewards and invite tracking', () => {
        const client = new DiscordBot();
        expect(voiceRewards.name).toBe(Events.VoiceStateUpdate);
        expect(inviteCreate.name).toBe(Events.InviteCreate);
        expect(inviteDelete.name).toBe(Events.InviteDelete);
        expect(client.options.intents.has(GatewayIntentBits.GuildVoiceStates)).toBe(true);
        expect(client.options.intents.has(GatewayIntentBits.GuildInvites)).toBe(true);
    });
});
