import { ChatGroq } from '@langchain/groq';
import { SystemMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { config } from '../../../config.js';
import {
    resolveGroqMaxTokens,
    resolveGroqModel,
    resolveGroqReasoningOptions,
} from './groqModel.js';

/** A bounded chat integration; it has no autonomous tool execution. */
export class Agent {
    private readonly model: ChatGroq;
    constructor() {
        if (!process.env.GROQ_API_KEY)
            throw new Error('AI is unavailable: GROQ_API_KEY is missing');
        const model = resolveGroqModel(config.ai.model);
        this.model = new ChatGroq({
            model,
            maxTokens: resolveGroqMaxTokens(model, config.ai.maxTokens),
            temperature: config.ai.temperature,
            apiKey: process.env.GROQ_API_KEY,
            timeout: config.ai.timeoutMs,
            maxRetries: 0,
            ...resolveGroqReasoningOptions(model),
        });
    }
    async getResponse(input: string, history: BaseMessage[] = []) {
        return this.model.invoke(
            [new SystemMessage(config.ai.systemPrompt), ...history, new HumanMessage(input)],
            { signal: AbortSignal.timeout(config.ai.timeoutMs) },
        );
    }
}
