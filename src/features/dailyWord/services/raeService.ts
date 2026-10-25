import logger from '../../../utils/logger.js';
import { z } from 'zod';
import { readJson } from '../../../shared/utils/http.js';
import { SingleFlight } from '../../../shared/services/SingleFlight.js';

const wordSchema = z.object({
    ok: z.boolean(),
    data: z.object({ word: z.string().min(1).max(256) }).optional(),
});
const entrySchema = z.object({
    ok: z.boolean(),
    data: z
        .object({
            word: z.string().min(1).max(256),
            meanings: z
                .array(
                    z.object({
                        senses: z
                            .array(
                                z.object({
                                    raw: z.string().max(10_000),
                                    description: z.string().max(10_000).default(''),
                                    category: z.string().optional(),
                                    gender: z.string().optional(),
                                }),
                            )
                            .max(100),
                    }),
                )
                .max(100),
        })
        .optional(),
});
const suggestionsSchema = z.object({
    suggestions: z.array(z.string().max(128)).max(20).default([]),
});

export interface RAEResponse<T> {
    ok: boolean;
    data?: T;
    error?: string;
    suggestions?: string[];
}

export interface WordOnlyData {
    word: string;
}

export interface WordEntryData {
    word: string;
    meanings: Meaning[];
}

export interface Meaning {
    senses: Definition[];
}

export interface Definition {
    raw: string;
    description: string;
    category?: string;
    gender?: string;
}

export interface FetchResult {
    unavailable?: boolean;
    data: WordEntryData | null;
    suggestions: string[];
}

export class RAEService {
    private active = 0;
    private readonly requests = new SingleFlight<string, { status: number; payload: unknown }>();
    private readonly definitions = new SingleFlight<string, FetchResult>();
    private requestJson(url: string) {
        return this.requests.run(url, async () => {
            if (this.active >= 4) throw new Error('Dictionary request capacity exceeded');
            this.active++;
            try {
                const response = await this.request(url, { signal: AbortSignal.timeout(10_000) });
                if (!response.ok && response.status !== 404) {
                    await response.body?.cancel();
                    return { status: response.status, payload: null };
                }
                return { status: response.status, payload: await readJson(response) };
            } finally {
                this.active--;
            }
        });
    }
    private readonly baseUrl = 'https://rae-api.com/api';
    constructor(
        private readonly request: (url: string, options?: RequestInit) => Promise<Response> = fetch,
    ) {}

    async fetchWordOfTheDay(): Promise<string | null> {
        try {
            const response = await this.requestJson(`${this.baseUrl}/daily`);
            if (response.status !== 200) return null;

            const json = wordSchema.parse(response.payload);
            return json.ok && json.data ? json.data.word : null;
        } catch (error) {
            logger.error('Failed to fetch word of the day', { error });
            return null;
        }
    }

    fetchWordDefinition(word: string): Promise<FetchResult> {
        return this.definitions.run(word, () => this.fetchDefinition(word));
    }

    private async fetchDefinition(word: string): Promise<FetchResult> {
        try {
            const response = await this.requestJson(
                `${this.baseUrl}/words/${encodeURIComponent(word.slice(0, 128))}`,
            );

            // Handle 404 specially as it might contain suggestions
            if (response.status === 404) {
                const json = suggestionsSchema.parse(response.payload);
                return { data: null, suggestions: json.suggestions || [] };
            }

            if (response.status !== 200) return { data: null, suggestions: [], unavailable: true };

            const json = entrySchema.parse(response.payload);
            return {
                data: json.ok && json.data ? json.data : null,
                suggestions: [],
            };
        } catch (error) {
            logger.error('Failed to fetch word definition', { word, error });
            return { data: null, suggestions: [], unavailable: true };
        }
    }
}

export default new RAEService();
