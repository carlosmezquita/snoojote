import { Events, type Message } from 'discord.js';
import { type DiscordBot } from '../../../core/client.js';
import { config } from '../../../config.js';
import { Agent } from '../services/Agent.js';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import logger from '../../../utils/logger.js';
import { Cooldown } from '../../../shared/services/Cooldown.js';
import { stripLeadingThinking } from '../services/responseSanitizer.js';

export function createAiHandler(createAgent: () => Pick<Agent, 'getResponse'> = () => new Agent()) {
    let agent: Pick<Agent, 'getResponse'> | undefined;
    const requests = new Cooldown();
    const busyNotices = new Cooldown();
    let activeRequests = 0;

    return {
        name: Events.MessageCreate,
        once: false,
        execute: async (message: Message, client: DiscordBot) => {
            if (message.author.bot || !message.guild) return;

            if (message.channelId !== config.channels.ai) return;

            // Check if the bot is mentioned
            if (message.mentions.has(client.user!)) {
                if (
                    !requests.acquire(
                        `${message.guildId}:${message.author.id}`,
                        config.ai.cooldownSeconds * 1000,
                    )
                )
                    return;
                if (activeRequests >= config.ai.maxConcurrent) {
                    if (busyNotices.acquire(message.channelId, 30_000))
                        await message.reply({
                            content: 'Estoy ocupado. Inténtalo de nuevo en unos segundos.',
                            allowedMentions: { parse: [], repliedUser: false },
                        });
                    return;
                }
                activeRequests++;
                try {
                    if ('sendTyping' in message.channel) await message.channel.sendTyping();
                    agent ??= createAgent();
                    const history: BaseMessage[] = [];
                    let currentMessage = message;

                    // Build history by traversing the reply chain
                    // Limit history to last 10 messages to avoid context limit issues
                    let depth = 0;
                    let remaining = Math.max(
                        0,
                        config.ai.contextCharacters - message.content.length,
                    );
                    while (
                        currentMessage.reference &&
                        currentMessage.reference.messageId &&
                        depth < 10 &&
                        remaining > 0
                    ) {
                        try {
                            const referencedMessage = await message.channel.messages.fetch(
                                currentMessage.reference.messageId,
                            );
                            if (!referencedMessage) break;

                            if (referencedMessage.author.id === client.user!.id) {
                                const content = referencedMessage.content.slice(
                                    0,
                                    Math.min(2000, remaining),
                                );
                                history.unshift(new AIMessage(content));
                                remaining -= content.length;
                            } else {
                                // Replace bot mention in history too, to make it cleaner for the AI
                                const text = referencedMessage.content
                                    .replace(new RegExp(`<@!?${client.user!.id}>`, 'g'), 'Snoojote')
                                    .trim();
                                const bounded = text.slice(0, Math.min(2000, remaining));
                                history.unshift(new HumanMessage(bounded));
                                remaining -= bounded.length;
                            }
                            currentMessage = referencedMessage;
                            depth++;
                        } catch (err) {
                            logger.warn(`Could not fetch referenced message: ${err}`);
                            break;
                        }
                    }

                    const text = message.content
                        .replace(new RegExp(`<@!?${client.user!.id}>`, 'g'), 'Snoojote')
                        .trim();

                    const response = await agent.getResponse(
                        text.slice(0, config.ai.contextCharacters),
                        history,
                    );
                    const raw =
                        typeof response.content === 'string'
                            ? response.content
                            : response.content
                                  .map((block) =>
                                      'text' in block && typeof block.text === 'string'
                                          ? block.text
                                          : '',
                                  )
                                  .join('');
                    let content = stripLeadingThinking(raw);

                    if (!content) {
                        logger.warn('AI response contained no visible content after sanitization');
                        await message.reply(
                            'No he podido generar una respuesta. Inténtalo de nuevo.',
                        );
                        return;
                    }

                    if (content.length > 2000) {
                        content = content.slice(0, 1993) + ' (...)';
                    }

                    await message.reply({
                        content,
                        allowedMentions: { parse: [], repliedUser: false },
                    });
                } catch (error) {
                    logger.error('Error generating AI response:', error);
                    await message.reply(
                        'Ha ocurrido un fallo técnico. Por favor, inténtalo de nuevo más tarde.',
                    );
                } finally {
                    activeRequests--;
                }
            }
        },
    };
}

export default createAiHandler();
