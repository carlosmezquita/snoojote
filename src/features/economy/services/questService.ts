import { ChannelType, TextChannel } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';

export enum QuestType {
    MESSAGE_COUNT = 'MESSAGE_COUNT',
    VOICE_TIME = 'VOICE_TIME'
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

        const channels = client.channels.cache.filter(c =>
            c.type === ChannelType.GuildText &&
            !c.name.includes('log') &&
            !c.name.includes('verify') &&
            !c.name.includes('ticket')
        );

        const channelList = Array.from(channels.values());
        if (channelList.length === 0) {
            // Fallback if no suitable channel found (unlikely)
            return {
                type: QuestType.MESSAGE_COUNT,
                current: 0,
                goal: 5,
                description: 'Send 5 messages in any channel.',
                isCompleted: false
            };
        }

        const targetChannel = channelList[Math.floor(Math.random() * channelList.length)] as TextChannel;
        const goal = Math.floor(Math.random() * 3) + 3; // 3 to 5 messages

        return {
            type: QuestType.MESSAGE_COUNT,
            targetId: targetChannel.id,
            targetName: targetChannel.name,
            current: 0,
            goal: goal,
            description: `Send ${goal} messages in <#${targetChannel.id}>`,
            isCompleted: false
        };
    }

    private generateVoiceQuest(): QuestData {
        const goal = Math.floor(Math.random() * 10) + 10; // 10 to 20 minutes
        return {
            type: QuestType.VOICE_TIME,
            current: 0,
            goal: goal, // stored in minutes for simplicity in display, but we might track internally differently
            description: `Spend ${goal} minutes in any voice channel`,
            isCompleted: false
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
