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
    data: WordEntryData | null;
    suggestions: string[];
}

export class RAEService {
    private readonly baseUrl = 'https://rae-api.com/api';

    async fetchWordOfTheDay(): Promise<string | null> {
        try {
            const response = await fetch(`${this.baseUrl}/daily`);
            if (!response.ok) return null;

            const json = (await response.json()) as RAEResponse<WordOnlyData>;
            return json.ok && json.data ? json.data.word : null;
        } catch (error) {
            console.error('Error fetching word of the day:', error);
            return null;
        }
    }

    async fetchWordDefinition(word: string): Promise<FetchResult> {
        try {
            const response = await fetch(`${this.baseUrl}/words/${encodeURIComponent(word)}`);

            // Handle 404 specially as it might contain suggestions
            if (response.status === 404) {
                const json = (await response.json()) as RAEResponse<null>;
                return { data: null, suggestions: json.suggestions || [] };
            }

            if (!response.ok) return { data: null, suggestions: [] };

            const json = (await response.json()) as RAEResponse<WordEntryData>;
            return {
                data: json.ok && json.data ? json.data : null,
                suggestions: [],
            };
        } catch (error) {
            console.error(`Error fetching definition for ${word}:`, error);
            return { data: null, suggestions: [] };
        }
    }
}

export default new RAEService();
