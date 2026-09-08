import { ChatGroq } from '@langchain/groq';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { config } from '../../../config.js';
import {
    resolveGroqMaxTokens,
    resolveGroqModel,
    resolveGroqReasoningOptions,
} from './groqModel.js';

export class Agent {
    private chatGroq: ChatGroq;
    private chain: any;

    constructor() {
        const model = resolveGroqModel(config.ai.model);

        this.chatGroq = new ChatGroq({
            maxTokens: resolveGroqMaxTokens(model, config.ai.maxTokens),
            temperature: config.ai.temperature,
            model,
            apiKey: process.env.GROQ_API_KEY,
            ...resolveGroqReasoningOptions(model),
        });

        const prompt = ChatPromptTemplate.fromMessages([
            new SystemMessage(config.ai.systemPrompt),
            new MessagesPlaceholder('history'),
            ['human', '{input}'],
        ]);

        this.chain = prompt.pipe(this.chatGroq);
    }

    async getResponse(input: string, history: BaseMessage[] = []) {
        return await this.chain.invoke({
            input,
            history,
        });
    }
}
