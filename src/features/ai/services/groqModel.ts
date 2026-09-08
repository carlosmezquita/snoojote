const QWEN_3_6_MODEL = 'qwen/qwen3.6-27b';
const QWEN_3_6_FREE_TIER_MAX_TOKENS = 500;

const GROQ_MODEL_REPLACEMENTS: Record<string, string> = {
    'llama-3.1-8b-instant': QWEN_3_6_MODEL,
};

export function resolveGroqModel(model: string): string {
    return GROQ_MODEL_REPLACEMENTS[model] ?? model;
}

export function resolveGroqMaxTokens(model: string, configuredMaxTokens: number): number {
    const resolvedModel = resolveGroqModel(model);

    if (resolvedModel === QWEN_3_6_MODEL) {
        return Math.min(configuredMaxTokens, QWEN_3_6_FREE_TIER_MAX_TOKENS);
    }

    return configuredMaxTokens;
}

export function isQwen36Model(model: string): boolean {
    return resolveGroqModel(model) === QWEN_3_6_MODEL;
}
