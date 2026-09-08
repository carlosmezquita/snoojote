const GROQ_MODEL_REPLACEMENTS: Record<string, string> = {
    'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
};

export function resolveGroqModel(model: string): string {
    return GROQ_MODEL_REPLACEMENTS[model] ?? model;
}
