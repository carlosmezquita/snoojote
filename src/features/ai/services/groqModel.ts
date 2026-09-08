const GROQ_MODEL_REPLACEMENTS: Record<string, string> = {
    'llama-3.1-8b-instant': 'qwen/qwen3.6-27b',
};

export function resolveGroqModel(model: string): string {
    return GROQ_MODEL_REPLACEMENTS[model] ?? model;
}
