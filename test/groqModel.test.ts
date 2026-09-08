import { describe, expect, test } from 'bun:test';
import {
    isQwen36Model,
    resolveGroqMaxTokens,
    resolveGroqModel,
} from '../src/features/ai/services/groqModel.js';

describe('Groq model config', () => {
    test('maps the retired llama-3.1-8b-instant model to Qwen replacement', () => {
        expect(resolveGroqModel('llama-3.1-8b-instant')).toBe('qwen/qwen3.6-27b');
    });

    test('preserves explicitly configured supported models', () => {
        expect(resolveGroqModel('qwen/qwen3.8-27b')).toBe('qwen/qwen3.8-27b');
    });

    test('caps Qwen 3.6 output below the free-tier OTPM limit', () => {
        expect(resolveGroqMaxTokens('qwen/qwen3.6-27b', 1024)).toBe(800);
    });

    test('caps legacy Llama configs after resolving them to Qwen', () => {
        expect(resolveGroqMaxTokens('llama-3.1-8b-instant', 1024)).toBe(800);
    });

    test('does not increase smaller configured Qwen limits', () => {
        expect(resolveGroqMaxTokens('qwen/qwen3.6-27b', 500)).toBe(500);
    });

    test('does not cap unrelated models', () => {
        expect(resolveGroqMaxTokens('qwen/qwen3.8-27b', 1024)).toBe(1024);
    });

    test('identifies Qwen 3.6 including legacy configs that resolve to it', () => {
        expect(isQwen36Model('qwen/qwen3.6-27b')).toBe(true);
        expect(isQwen36Model('llama-3.1-8b-instant')).toBe(true);
        expect(isQwen36Model('qwen/qwen3.8-27b')).toBe(false);
    });
});
