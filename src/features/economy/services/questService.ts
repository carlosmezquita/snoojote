import { ChannelType, type TextChannel } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';

export enum QuestType {
    MESSAGE_COUNT = 'MESSAGE_COUNT',
    VOICE_TIME = 'VOICE_TIME',
}

export interface QuestData {
    type: QuestType;
    targetId?: string; // Channel ID
    targetName?: string; // Channel Name for display
    current: number;
    goal: number;
    description: string;
    isCompleted: boolean;
}

export class QuestService {
    isExcludedQuestChannel(channelId: string | null | undefined): boolean {
        return !!channelId && config.economy.questExcludedChannelIds.includes(channelId);
    }

    getGuidelines(quest: QuestData): string {
        if (quest.type === QuestType.MESSAGE_COUNT) {
            const target = quest.targetId
                ? `<#${quest.targetId}>`
                : 'cualquier canal de texto permitido';
            return `Envía mensajes con contenido en ${target}. Los mensajes en canales excluidos no cuentan, y el progreso respeta el enfriamiento de recompensas.`;
        }

        return 'Permanece en un canal de voz permitido. El progreso cuenta minutos completos y se sincroniza al salir, al cambiar de canal de voz o al ejecutar `/daily` mientras sigues conectado.';
    }

    // Generate a new random quest
    async generateQuest(client: DiscordBot): Promise<QuestData> {
        const types = [QuestType.MESSAGE_COUNT, QuestType.VOICE_TIME];
        const selectedType = types[Math.floor(Math.random() * types.length)];

        if (selectedType === QuestType.MESSAGE_COUNT) {
            return this.generateMessageQuest(client);
        } else {
            return this.generateVoiceQuest();
        }
    }

    private async generateMessageQuest(client: DiscordBot): Promise<QuestData> {
        // Find a suitable text channel (not rules, not announcements, etc if possible)
        // For simplicity, we can fetch cached channels or just pick a random text channel the bot can see.
        // In a real app, you might want to filter by specific categories.

        const channels = client.channels.cache.filter(
            (c) =>
                c.type === ChannelType.GuildText &&
                !this.isExcludedQuestChannel(c.id) &&
                !c.name.includes('log') &&
                !c.name.includes('verify') &&
                !c.name.includes('ticket'),
        );

        const channelList = Array.from(channels.values());
        if (channelList.length === 0) {
            // Fallback if no suitable channel found (unlikely)
            return {
                type: QuestType.MESSAGE_COUNT,
                current: 0,
                goal: 5,
                description: 'Envía 5 mensajes en cualquier canal permitido.',
                isCompleted: false,
            };
        }

        const targetChannel = channelList[
            Math.floor(Math.random() * channelList.length)
        ] as TextChannel;
        const goal = Math.floor(Math.random() * 3) + 3; // 3 to 5 messages

        return {
            type: QuestType.MESSAGE_COUNT,
            targetId: targetChannel.id,
            targetName: targetChannel.name,
            current: 0,
            goal: goal,
            description: `Envía ${goal} mensajes en <#${targetChannel.id}>`,
            isCompleted: false,
        };
    }

    private generateVoiceQuest(): QuestData {
        const dailyCap = config.economy.voiceRewards.dailyCap;
        const goal = Math.min(Math.floor(Math.random() * 10) + 10, dailyCap);
        return {
            type: QuestType.VOICE_TIME,
            current: 0,
            goal: goal, // stored in minutes for simplicity in display, but we might track internally differently
            description: `Pasa ${goal} minutos en cualquier canal de voz permitido`,
            isCompleted: false,
        };
    }

    // Check if quest is completed
    checkCompletion(quest: QuestData): boolean {
        if (quest.current >= quest.goal) {
            quest.isCompleted = true;
            return true;
        }
        return false;
    }
}

export default new QuestService();
