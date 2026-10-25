/** Limit even chunked bodies; Content-Length alone is not a trustworthy bound. */
export async function readJson(response: Response, maximumBytes = 256 * 1024): Promise<unknown> {
    if (!response.body) throw new Error('Empty HTTP response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > maximumBytes) throw new Error('HTTP response exceeds size limit');
            chunks.push(chunk.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally {
        await reader.cancel().catch(() => {});
    }
}
