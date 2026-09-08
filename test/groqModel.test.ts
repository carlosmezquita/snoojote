import { describe, expect, test } from 'bun:test';
import { resolveGroqModel } from '../src/features/ai/services/groqModel.js';

describe('resolveGroqModel', () => {
    test('maps the retired llama-3.1-8b-instant model to Groq replacement', () => {
        expect(resolveGroqModel('llama-3.1-8b-instant')).toBe('openai/gpt-oss-20b');
    });

    test('preserves explicitly configured supported models', () => {
        expect(resolveGroqModel('llama-3.3-70b-versatile')).toBe('llama-3.3-70b-versatile');
    });
});
