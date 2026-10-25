import { describe, expect, test } from 'bun:test';
import {
    resolveGroqMaxTokens,
    resolveGroqModel,
    resolveGroqReasoningOptions,
} from '../src/features/ai/services/groqModel.js';

describe('Groq model config', () => {
    test('maps the retired llama-3.1-8b-instant model to Qwen replacement', () => {
        expect(resolveGroqModel('llama-3.1-8b-instant')).toBe('qwen/qwen3.6-27b');
    });

    test('preserves explicitly configured supported models', () => {
        expect(resolveGroqModel('qwen/qwen3.8-27b')).toBe('qwen/qwen3.8-27b');
    });

    test('caps Qwen 3.6 output for the free-tier OTPM budget', () => {
        expect(resolveGroqMaxTokens('qwen/qwen3.6-27b', 1024)).toBe(500);
    });

    test('caps legacy Llama configs after resolving them to Qwen', () => {
        expect(resolveGroqMaxTokens('llama-3.1-8b-instant', 1024)).toBe(500);
    });

    test('does not increase smaller configured Qwen limits', () => {
        expect(resolveGroqMaxTokens('qwen/qwen3.6-27b', 400)).toBe(400);
    });

    test('does not cap unrelated models', () => {
        expect(resolveGroqMaxTokens('qwen/qwen3.8-27b', 1024)).toBe(1024);
    });

    test('disables Qwen 3.6 reasoning while keeping it hidden defensively', () => {
        expect(resolveGroqReasoningOptions('qwen/qwen3.6-27b')).toEqual({
            reasoningEffort: 'none',
            reasoningFormat: 'hidden',
        });
    });

    test('applies Qwen reasoning settings to legacy Llama configs', () => {
        expect(resolveGroqReasoningOptions('llama-3.1-8b-instant')).toEqual({
            reasoningEffort: 'none',
            reasoningFormat: 'hidden',
        });
    });

    test('does not alter reasoning settings for unrelated models', () => {
        expect(resolveGroqReasoningOptions('qwen/qwen3.8-27b')).toEqual({});
    });
});
