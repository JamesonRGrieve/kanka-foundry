import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeEventGraphAttribute, EVENT_GRAPH_CODEC, KANKA_ATTRIBUTE_MAX_LEN } from './eventGraphCodec.ts';

describe('decodeEventGraphAttribute', () => {
    it('passes through legacy raw JSON payloads', async () => {
        const payload = { events: { FOO: { name: 'Foo' } } };
        const decoded = await decodeEventGraphAttribute(JSON.stringify(payload));
        expect(decoded).toEqual(payload);
    });

    it('decodes gzip+b64 envelopes', async () => {
        const payload = { events: { BAR: { name: 'Bar', excuse: 'x'.repeat(2000) } } };
        const json = JSON.stringify(payload);
        const data = gzipSync(Buffer.from(json, 'utf8')).toString('base64');
        const envelope = JSON.stringify({ _codec: EVENT_GRAPH_CODEC, data });
        const decoded = await decodeEventGraphAttribute(envelope);
        expect(decoded).toEqual(payload);
    });

    it('rejects payloads truncated at the Kanka attribute ceiling', async () => {
        // EXACTLY the cap: Kanka cuts the value at 65,535 characters, so a stored
        // value of precisely that length is the truncation signature. The guard
        // fires at `>= MAX`, so the string must reach it — one short falls through
        // to JSON.parse and yields the bare "Unterminated string" SyntaxError this
        // guard exists to replace.
        const truncated = `"${'x'.repeat(KANKA_ATTRIBUTE_MAX_LEN - 1)}`;
        expect(truncated).toHaveLength(KANKA_ATTRIBUTE_MAX_LEN);
        await expect(decodeEventGraphAttribute(truncated)).rejects.toThrow(/truncated/);
    });

    it('names the cap and the observed length so the cause is unambiguous', async () => {
        const truncated = 'x'.repeat(KANKA_ATTRIBUTE_MAX_LEN);
        await expect(decodeEventGraphAttribute(truncated)).rejects.toThrow(String(KANKA_ATTRIBUTE_MAX_LEN));
    });

    // This case caught a real deadlock: the decoder awaited `writer.write()` before
    // anything consumed the readable side, so any payload larger than the stream's
    // internal queue hung forever. Small envelopes fit the queue and masked it — so
    // only a genuinely over-cap payload exercises the bug. Keep it big.
    it('decodes an envelope whose RAW form would exceed the cap', async () => {
        // The real graph is ~187 KB — this is the case the codec exists for.
        const payload = { events: Object.fromEntries(Array.from({ length: 400 }, (_, n) => [`E${String(n)}`, { name: `Event ${String(n)}`, notes: 'lorem ipsum '.repeat(20) }])) };
        const json = JSON.stringify(payload);
        const envelope = JSON.stringify({ _codec: EVENT_GRAPH_CODEC, data: gzipSync(Buffer.from(json, 'utf8')).toString('base64') });
        expect(json.length).toBeGreaterThan(KANKA_ATTRIBUTE_MAX_LEN);
        expect(envelope.length).toBeLessThan(KANKA_ATTRIBUTE_MAX_LEN);
        expect(await decodeEventGraphAttribute(envelope)).toEqual(payload);
    });
});
