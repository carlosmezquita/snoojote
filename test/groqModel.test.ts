import { describe, expect, test } from 'bun:test';
import { resolveGroqModel } from '../src/features/ai/services/groqModel.js';

describe('resolveGroqModel', () => {
    test('maps the retired llama-3.1-8b-instant model to Qwen replacement', () => {
        expect(resolveGroqModel('llama-3.1-8b-instant')).toBe('qwen/qwen3.6-27b');
    });

    test('preserves explicitly configured supported models', () => {
        expect(resolveGroqModel('qwen/qwen3.8-27b')).toBe('qwen/qwen3.8-27b');
    });
});
