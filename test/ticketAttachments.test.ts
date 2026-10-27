import { describe, expect, test } from 'bun:test';
import {
    archiveFilename,
    attachmentByteLimit,
    downloadAttachment,
    prepareScreenshots,
    validateAttachment,
    withAttachmentTransfer,
    type TicketAttachment,
} from '../src/features/tickets/services/ticketAttachments.js';

const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
    'base64',
);
function attachment(overrides: Partial<TicketAttachment> = {}): TicketAttachment {
    return {
        id: '123',
        name: 'proof.png',
        size: png.length,
        contentType: 'image/png',
        spoiler: false,
        url: 'https://cdn.discordapp.com/ephemeral-attachments/100/123/proof.png?ex=123&hm=signature',
        ...overrides,
    };
}

describe('ticket screenshot validation and transfer', () => {
    test('empty uploads need no HTTP calls; valid screenshots retain their exact bytes', async () => {
        let calls = 0;
        const fetcher = async (url: string, init: RequestInit) => {
            calls++;
            expect(url).toContain('ephemeral-attachments');
            expect(init.redirect).toBe('error');
            expect(init.signal).toBeInstanceOf(AbortSignal);
            return new Response(png);
        };
        expect(await prepareScreenshots([], fetcher)).toEqual([]);
        expect(calls).toBe(0);
        const [file] = await prepareScreenshots(
            [attachment({ name: '../../unsafe.svg', spoiler: true })],
            fetcher,
        );
        expect(file.attachment).toEqual(png);
        expect(file.name).toBe('SPOILER_screenshot-1.png');
        expect(calls).toBe(1);
    });

    test('enforces count and total bytes before downloading anything', async () => {
        let calls = 0;
        const fetcher = async () => {
            calls++;
            return new Response(png);
        };
        await expect(
            prepareScreenshots(
                Array.from({ length: 4 }, () => attachment()),
                fetcher,
            ),
        ).rejects.toThrow('3 capturas');
        await expect(
            prepareScreenshots([attachment({ size: attachmentByteLimit }), attachment()], fetcher),
        ).rejects.toThrow('8 MiB en total');
        expect(calls).toBe(0);
    });

    test('rejects arbitrary URLs, credentials, ports, redirects and invalid sizes', async () => {
        for (const url of [
            'http://cdn.discordapp.com/attachments/100/123/proof.png',
            'https://cdn.discordapp.com.evil.test/attachments/100/123/proof.png',
            'https://evil.test/proof.png',
            'https://127.0.0.1/proof.png',
            'https://cdn.discordapp.com:8443/attachments/100/123/proof.png',
            'https://user:password@cdn.discordapp.com/attachments/100/123/proof.png',
            'https://cdn.discordapp.com/icons/123/icon.png',
            'not a URL',
        ])
            expect(() => validateAttachment(attachment({ url }))).toThrow();
        for (const size of [0, -1, NaN, 1.5, Infinity, attachmentByteLimit + 1])
            expect(() => validateAttachment(attachment({ size }))).toThrow();
        await expect(
            prepareScreenshots([attachment()], async () => {
                throw new Error('redirect refused');
            }),
        ).rejects.toThrow('Vuelve a enviar');
    });

    test('rejects SVG, unexpected media types and content disguised as an image', async () => {
        await expect(
            prepareScreenshots([attachment({ contentType: 'image/svg+xml' })]),
        ).rejects.toThrow('PNG');
        await expect(prepareScreenshots([attachment({ contentType: null })])).rejects.toThrow(
            'PNG',
        );
        await expect(
            prepareScreenshots([attachment({ size: 8 })], async () => new Response('<script>')),
        ).rejects.toThrow('formato');
        await expect(
            prepareScreenshots(
                [attachment({ contentType: 'image/jpeg' })],
                async () => new Response(png),
            ),
        ).rejects.toThrow('formato');
    });

    test('checks supported image signatures without decoding or changing evidence', async () => {
        for (const [contentType, bytes, extension] of [
            ['image/jpeg', Buffer.from([255, 216, 255, 224]), 'jpg'],
            ['image/webp', Buffer.from('RIFF0000WEBP'), 'webp'],
            ['image/gif', Buffer.from('GIF89a'), 'gif'],
        ] as const) {
            const [file] = await prepareScreenshots(
                [attachment({ contentType, size: bytes.length })],
                async () => new Response(bytes),
            );
            expect(file.name).toBe(`screenshot-1.${extension}`);
            expect(file.attachment).toEqual(bytes);
        }
    });

    test('rejects failed, truncated, oversized and aborted responses; cancels the body', async () => {
        await expect(
            downloadAttachment(attachment(), async () => new Response(null, { status: 404 })),
        ).rejects.toThrow('descargar');
        await expect(
            downloadAttachment(attachment(), async () => new Response('short')),
        ).rejects.toThrow('incompleta');
        let cancelled = false;
        const fetcher = async () =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array(png.length + 1));
                    },
                    cancel() {
                        cancelled = true;
                    },
                }),
                { headers: { 'content-length': '1' } },
            );
        await expect(downloadAttachment(attachment(), fetcher)).rejects.toThrow('tamaño');
        expect(cancelled).toBe(true);
        await expect(
            downloadAttachment(attachment(), async () => new Response(png), AbortSignal.abort()),
        ).rejects.toThrow();
    });

    test('archive filenames cannot escape paths and retain spoiler protection', () => {
        const name = archiveFilename(
            attachment({ name: '../../private/évidence.png', spoiler: true }),
        );
        expect(name).toStartWith('SPOILER_123-');
        expect(name).not.toContain('/');
        expect(name).toEndWith('.png');
    });

    test('caps concurrent jobs and releases slots even when a job fails', async () => {
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const first = withAttachmentTransfer(() => pending);
        const second = withAttachmentTransfer(() => pending);
        try {
            await expect(withAttachmentTransfer(async () => {})).rejects.toThrow('Espera');
        } finally {
            release();
            await Promise.all([first, second]);
        }
        await expect(
            withAttachmentTransfer(async () => {
                throw new Error('failure');
            }),
        ).rejects.toThrow('failure');
        expect(await withAttachmentTransfer(async () => 'released')).toBe('released');
    });
});
