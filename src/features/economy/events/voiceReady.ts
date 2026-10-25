import { Events } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import questService from '../services/questService.js';
import voiceSessionService from '../services/voiceSessionService.js';

export const name = Events.ClientReady;
export const once = true;
export const execute = (client: DiscordBot) => {
    for (const guild of client.guilds.cache.values()) {
        if (config.guildId && guild.id !== config.guildId) continue;
        for (const state of guild.voiceStates.cache.values()) {
            if (
                state.channelId &&
                state.member &&
                !state.member.user.bot &&
                !questService.isExcludedQuestChannel(state.channelId)
            ) {
                voiceSessionService.start(state.id, state.channelId);
            }
        }
    }
};
