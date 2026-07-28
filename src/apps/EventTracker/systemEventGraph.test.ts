import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DispositionEntry, EventGraphNode } from './eventGraphPayload';
import { dispositionsFromCharacters, readSystemEventGraph } from './systemEventGraph';

/**
 * One character's entry in the system's `characters` map, as authored in the
 * vault. `dispositions` widens to `string` so the malformed-input cases can be
 * expressed without an `unknown` escape hatch — degrading on bad data instead of
 * throwing is the contract under test.
 */
interface CharacterStub {
    dispositions?: DispositionEntry[] | string;
    relationships?: Array<{ target: string; type: string; state: string }>;
}

/** The slice of the system's EventTracker this module reads. */
interface TrackerStub {
    graph: Record<string, EventGraphNode> | null;
    characters: Record<string, CharacterStub | string> | null;
}

/** Install a wh40k-rpg system stub carrying the loaded graph. */
function stubSystem(tracker: TrackerStub): void {
    vi.stubGlobal('game', { wh40k: { EventTracker: tracker } });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('readSystemEventGraph (#33)', () => {
    it('reads the graph the wh40k-rpg system already loaded', () => {
        stubSystem({ graph: { FOO: { name: 'Foo', source: 'Day 1' } }, characters: null });
        expect(readSystemEventGraph().graph).toEqual({ FOO: { name: 'Foo', source: 'Day 1' } });
    });

    it('returns an empty payload when the system is absent', () => {
        // A world running some other system, or the plugin loading before the
        // system's ready hook — neither is an error, both must render.
        vi.stubGlobal('game', {});
        expect(readSystemEventGraph()).toEqual({ graph: {}, dispositions: {} });
    });

    it('returns an empty payload on a player client, where the GM-only document is never delivered', () => {
        // This is the POINT of the GM-secret ruling: the system finds no
        // document, so `graph` stays null and the tracker shows nothing.
        stubSystem({ graph: null, characters: null });
        expect(readSystemEventGraph()).toEqual({ graph: {}, dispositions: {} });
    });

    it('maps the system character map onto dispositions', () => {
        stubSystem({
            graph: {},
            characters: { Varo: { dispositions: [{ attitude: 'wary', note: 'after the raid' }] } },
        });
        expect(readSystemEventGraph().dispositions).toEqual({
            Varo: { entity_id: null, states: [{ attitude: 'wary', note: 'after the raid' }], pcAttitudes: {} },
        });
    });
});

describe('dispositionsFromCharacters', () => {
    it('leaves entity_id null — the vault has no Kanka ids, they are resolved from Kanka', () => {
        const out = dispositionsFromCharacters({ Varo: { dispositions: [{ attitude: 'hostile', note: '' }] } });
        expect(out).toEqual({ Varo: { entity_id: null, states: [{ attitude: 'hostile', note: '' }], pcAttitudes: {} } });
    });

    it('skips characters that declare only relationships', () => {
        // The dispositions map drives the Relations tab; a character with no
        // disposition states has nothing to show there.
        const out = dispositionsFromCharacters({ Kess: { relationships: [{ target: 'Varo', type: 'ally', state: 'ally' }] } });
        expect(out).toEqual({});
    });

    it('degrades a malformed character to a skip rather than throwing', () => {
        const out = dispositionsFromCharacters({ Varo: 'nonsense', Kess: { dispositions: 'broken' } });
        expect(out).toEqual({});
    });

    it('returns an empty map when there are no characters at all', () => {
        expect(dispositionsFromCharacters(undefined)).toEqual({});
    });
});
