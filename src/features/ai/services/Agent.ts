import { ChatGroq } from '@langchain/groq';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { config } from '../../../config.js';

export class Agent {
    private chatGroq: ChatGroq;
    private chain: any;

    constructor() {
        this.chatGroq = new ChatGroq({
            maxTokens: config.ai.maxTokens,
            temperature: config.ai.temperature,
            model: config.ai.model,
            apiKey: process.env.GROQ_API_KEY,
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
