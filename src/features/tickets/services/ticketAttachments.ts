import { AttachmentBuilder, type Attachment } from 'discord.js';

export const screenshotLimit = 3;
export const attachmentByteLimit = 8 * 1024 * 1024;
export const archiveAttachmentLimit = 20;
export const archiveAttachmentByteLimit = 32 * 1024 * 1024;

export type TicketAttachment = Pick<
    Attachment,
    'id' | 'name' | 'url' | 'size' | 'contentType' | 'spoiler'
>;
export type AttachmentFetcher = (url: string, init: RequestInit) => Promise<Response>;
export const fetchAttachment: AttachmentFetcher = (url, init) => fetch(url, init);

export class TicketAttachmentError extends Error {}

let activeTransfers = 0;
/** Keep whole file-transfer jobs bounded, including buffers awaiting a Discord send. */
export async function withAttachmentTransfer<T>(work: () => Promise<T>): Promise<T> {
    if (activeTransfers >= 2)
        throw new TicketAttachmentError(
            'Hay otras pruebas procesándose. Espera unos segundos y vuelve a intentarlo.',
        );
    activeTransfers++;
    try {
        return await work();
    } finally {
        activeTransfers--;
    }
}

export function validateAttachment(attachment: TicketAttachment) {
    let url: URL;
    try {
        url = new URL(attachment.url);
    } catch {
        throw new TicketAttachmentError('El archivo no tiene una dirección válida de Discord.');
    }
    if (
        url.protocol !== 'https:' ||
        url.port ||
        url.username ||
        url.password ||
        url.hash ||
        !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) ||
        !/^\/(?:ephemeral-)?attachments\/\d+\/\d+\/[^/]+$/.test(url.pathname)
    )
        throw new TicketAttachmentError('Solo se admiten archivos adjuntos de Discord.');
    if (
        !Number.isSafeInteger(attachment.size) ||
        attachment.size <= 0 ||
        attachment.size > attachmentByteLimit
    )
        throw new TicketAttachmentError('Cada archivo debe ocupar entre 1 byte y 8 MiB.');
}

/** Never follow redirects or buffer an unbounded response, even if its size header is false. */
export async function downloadAttachment(
    attachment: TicketAttachment,
    fetcher: AttachmentFetcher = fetchAttachment,
    signal: AbortSignal = AbortSignal.timeout(15_000),
): Promise<Buffer> {
    validateAttachment(attachment);
    const response = await fetcher(attachment.url, { redirect: 'error', signal });
    if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new TicketAttachmentError(
            'No se pudo descargar el archivo de Discord. Vuelve a intentarlo.',
        );
    }
    const reader = response.body.getReader();
    const data = Buffer.alloc(attachment.size);
    let length = 0;
    try {
        while (true) {
            signal.throwIfAborted();
            const chunk = await reader.read();
            if (chunk.done) break;
            const nextLength = length + chunk.value.byteLength;
            if (nextLength > attachment.size || nextLength > attachmentByteLimit)
                throw new TicketAttachmentError('El archivo supera el tamaño permitido.');
            data.set(chunk.value, length);
            length = nextLength;
        }
        if (length !== attachment.size)
            throw new TicketAttachmentError(
                'La descarga del archivo está incompleta. Vuelve a intentarlo.',
            );
        return data;
    } finally {
        await reader.cancel().catch(() => {});
    }
}

const imageTypes = new Map([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
]);

function imageExtension(data: Buffer): string | undefined {
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
    if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP')
        return 'webp';
    if (['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) return 'gif';
    return undefined;
}

export async function prepareScreenshots(
    attachments: readonly TicketAttachment[],
    fetcher: AttachmentFetcher = fetchAttachment,
) {
    if (
        attachments.length > screenshotLimit ||
        attachments.reduce((total, attachment) => total + attachment.size, 0) > attachmentByteLimit
    )
        throw new TicketAttachmentError(
            'Puedes adjuntar hasta 3 capturas, con un máximo de 8 MiB en total.',
        );
    for (const attachment of attachments) {
        validateAttachment(attachment);
        if (!imageTypes.has(attachment.contentType ?? ''))
            throw new TicketAttachmentError(
                'Las capturas deben ser imágenes PNG, JPG, WebP o GIF.',
            );
    }
    const files: AttachmentBuilder[] = [];
    const signal = AbortSignal.timeout(30_000);
    for (const attachment of attachments) {
        let data: Buffer;
        try {
            data = await downloadAttachment(attachment, fetcher, signal);
        } catch (error) {
            if (error instanceof TicketAttachmentError) throw error;
            throw new TicketAttachmentError(
                'No se pudieron descargar las capturas. Vuelve a enviar el formulario.',
            );
        }
        const extension = imageExtension(data);
        if (!extension || extension !== imageTypes.get(attachment.contentType ?? ''))
            throw new TicketAttachmentError('Una captura no coincide con su formato de imagen.');
        files.push(
            new AttachmentBuilder(data, {
                name: `${attachment.spoiler ? 'SPOILER_' : ''}screenshot-${files.length + 1}.${extension}`,
            }),
        );
    }
    return files;
}

/** Names are inert Discord attachments; never use a supplied name as a filesystem path. */
export function archiveFilename(attachment: TicketAttachment) {
    const name = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'file';
    return `${attachment.spoiler ? 'SPOILER_' : ''}${attachment.id}-${name}`;
}
