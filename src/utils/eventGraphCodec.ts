/** Kanka entity attributes truncate at 65535 characters — compress large graphs. */
export const KANKA_ATTRIBUTE_MAX_LEN = 65535;
export const EVENT_GRAPH_CODEC = 'gzip+b64';

export interface EncodedEventGraphEnvelope {
    _codec: typeof EVENT_GRAPH_CODEC;
    data: string;
}

function isEncodedEnvelope(value: unknown): value is EncodedEventGraphEnvelope {
    if (value === null || typeof value !== 'object') return false;
    const codec: unknown = Reflect.get(value, '_codec');
    const data: unknown = Reflect.get(value, 'data');
    return codec === EVENT_GRAPH_CODEC && typeof data === 'string';
}

/** Decode an `event_graph` attribute value (raw JSON or gzip+b64 envelope). */
export async function decodeEventGraphAttribute(raw: string): Promise<unknown> {
    if (raw.length >= KANKA_ATTRIBUTE_MAX_LEN) {
        throw new Error(
            `event_graph attribute appears truncated at ${String(raw.length)} characters (Kanka limit ${String(KANKA_ATTRIBUTE_MAX_LEN)}) — re-run vault import to write the compressed graph`,
        );
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isEncodedEnvelope(parsed)) return parsed;

    const compressed = Uint8Array.from(atob(parsed.data), (char) => char.charCodeAt(0));
    const stream = new DecompressionStream('gzip');

    // Start consuming the readable side BEFORE writing. `writer.write()` resolves
    // only once the chunk is accepted, and with nothing draining the readable end
    // a payload larger than the stream's internal queue never drains — so awaiting
    // the write first deadlocks. Small payloads fit the queue and resolve
    // immediately, which is why this only bites at size: precisely the ~187 KB
    // graph this codec exists to carry.
    const decompressed = new Response(stream.readable).arrayBuffer();
    const writer = stream.writable.getWriter();
    const pumped = writer
        .write(compressed)
        .then(async () => {
            await writer.close();
        })
        .catch(async (err: unknown) => {
            await writer.abort(err);
            throw err;
        });

    const [buffer] = await Promise.all([decompressed, pumped]);
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
}
