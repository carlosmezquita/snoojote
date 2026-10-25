import { describe, expect, test } from 'bun:test';
import { stripLeadingThinking } from '../src/features/ai/services/responseSanitizer.js';

describe('stripLeadingThinking', () => {
    test('removes a leading think block and keeps the visible response', () => {
        expect(stripLeadingThinking('<think>internal reasoning</think>\nHola.')).toBe('Hola.');
    });

    test('removes multiple leading think blocks', () => {
        expect(
            stripLeadingThinking('<think>first</think>\n<think>second</think>\nRespuesta final'),
        ).toBe('Respuesta final');
    });

    test('preserves normal responses', () => {
        expect(stripLeadingThinking('Respuesta normal con <think> como texto.')).toBe(
            'Respuesta normal con <think> como texto.',
        );
    });

    test('suppresses an unclosed leading think block', () => {
        expect(stripLeadingThinking('<think>internal reasoning without closing tag')).toBe('');
    });
});
