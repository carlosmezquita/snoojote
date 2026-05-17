import { describe, expect, test } from 'bun:test';
import { getLinkRateLimitDecision } from '../src/features/moderation/events/linkSpam.js';
import { extractLinks } from '../src/shared/utils/links.js';

describe('link spam moderation', () => {
    test('allows the first link in the rate-limit window', () => {
        expect(getLinkRateLimitDecision(1)).toEqual({
            shouldDelete: false,
            shouldBan: false,
            violationCount: 0,
        });
    });

    test('deletes only links above the per-window limit', () => {
        expect(getLinkRateLimitDecision(2)).toEqual({
            shouldDelete: true,
            shouldBan: false,
            violationCount: 1,
        });
    });

    test('bans after three rate-limit violations', () => {
        expect(getLinkRateLimitDecision(4)).toEqual({
            shouldDelete: true,
            shouldBan: true,
            violationCount: 3,
        });
    });

    test('extracts Google AMP links as one URL', () => {
        const links = extractLinks(
            'https://www.google.com/amp/s/elpais.com/espana/elecciones-andalucia/2026-05-17/montero-empeora-el-peor-resultado-historico-del-psoe-en-andalucia.html%3FoutputType=amp',
        );

        expect(links).toHaveLength(1);
        expect(links[0]).toStartWith('https://www.google.com/amp/s/elpais.com/');
    });
});
