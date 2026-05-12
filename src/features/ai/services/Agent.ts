import { ChatGroq } from '@langchain/groq';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { SystemMessage, type BaseMessage } from '@langchain/core/messages';

export class Agent {
    private chatGroq: ChatGroq;
    private chain: any;

    constructor() {
        this.chatGroq = new ChatGroq({
            maxTokens: 1024,
            temperature: 0.7,
            model: 'llama-3.1-8b-instant',
            apiKey: process.env.GROQ_API_KEY,
        });

        const prompt = ChatPromptTemplate.fromMessages([
            new SystemMessage(
                `You are a helpful AI assistant named Snoojote. You are chatting in a Discord server.`,
            ), // Customizable system prompt
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
