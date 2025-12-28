import { Events, Message, MessageType } from 'discord.js';
import { DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import { Agent } from '../services/Agent.js';
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import logger from '../../../utils/logger.js';

const agent = new Agent();

export default {
    name: Events.MessageCreate,
    once: false,
    execute: async (message: Message, client: DiscordBot) => {
        if (message.author.bot) return;

        if (message.channelId !== config.channels.ai) return;

        // Check if the bot is mentioned
        if (message.mentions.has(client.user!)) {
            // Show typing indicator
            if ('sendTyping' in message.channel) {
                await message.channel.sendTyping();
            }

            try {
                const history: BaseMessage[] = [];
                let currentMessage = message;

                // Build history by traversing the reply chain
                // Limit history to last 10 messages to avoid context limit issues
                let depth = 0;
                while (currentMessage.reference && currentMessage.reference.messageId && depth < 10) {
                    try {
                        const referencedMessage = await message.channel.messages.fetch(currentMessage.reference.messageId);
                        if (!referencedMessage) break;

                        if (referencedMessage.author.id === client.user!.id) {
                            history.unshift(new AIMessage(referencedMessage.content));
                        } else {
                            // Replace bot mention in history too, to make it cleaner for the AI
                            const text = referencedMessage.content.replace(new RegExp(`<@!?${client.user!.id}>`, 'g'), 'Snoojote').trim();
                            history.unshift(new HumanMessage(text));
                        }
                        currentMessage = referencedMessage;
                        depth++;
                    } catch (err) {
                        logger.warn(`Could not fetch referenced message: ${err}`);
                        break;
                    }
                }

                const text = message.content.replace(new RegExp(`<@!?${client.user!.id}>`, 'g'), 'Snoojote').trim();

                const response = await agent.getResponse(text, history);
                let content = response.content as string;

                if (content.length > 2000) {
                    content = content.slice(0, 1993) + ' (...)';
                }

                await message.reply(content);

            } catch (error) {
                logger.error('Error generating AI response:', error);
                await message.reply("Ha ocurrido un fallo técnico. Por favor, inténtalo de nuevo más tarde.");
            }
        }
    }
};
