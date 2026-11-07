import { Events, type VoiceState } from 'discord.js';
import { notify, position, voiceObserver } from '../services/voiceLedger.js';
export default {
    name: Events.VoiceStateUpdate,
    once: false,
    async execute(oldState: VoiceState, newState: VoiceState) {
        const member = newState.member ?? oldState.member;
        if (!member || member.user.bot) return;
        const from = position(oldState),
            to = position(newState);
        if (from.channelId === to.channelId && from.sessionId === to.sessionId) return;
        const completion = voiceObserver.observe(
            newState.guild.id,
            member.id,
            from,
            to,
            newState.client,
        );
        await notify(newState.client, member.id, completion);
    },
};
