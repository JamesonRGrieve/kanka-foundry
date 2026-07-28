/**
 * Read the campaign event graph from the wh40k-rpg system.
 *
 * WHY (dh-campaign#33). The graph used to arrive over a Kanka entity attribute,
 * gzip+b64-encoded to fit — and it stopped fitting: 67,359 chars against Kanka's
 * 65,535 cap, on a graph that grows every session. The operator's ruling is that
 * the graph is GM-SECRET, so it now lives in a JournalEntry with
 * `ownership.default = NONE`, written into the world by `deploy.sh`.
 *
 * The system already loads that document at `ready` and holds the parsed graph
 * on `game.wh40k.EventTracker`, so this plugin consumes THAT copy rather than
 * carrying a second transport. One parse, one in-memory graph — which also
 * retires the codec that existed only to squeeze the payload under the cap.
 *
 * The `entity_id` that used to ride along inside the attribute is NOT in the
 * vault's export (the vault has no Kanka ids). It is resolved from Kanka
 * instead, by the caller — which is the more honest source anyway.
 */

import { type PlainObject, asRecord, readProp } from '../../util/reflection';
import type { DispositionEntry, DispositionMap, EventGraph, EventGraphPayload } from './eventGraphPayload';

/**
 * Structural assertion with no runtime check and no `as`. Used only where the
 * container has already been verified (an object, an array) and the element
 * shape is the vault's authoring contract rather than something we can test.
 */
// eslint-disable-next-line no-restricted-syntax -- boundary: assertion-function parameter, the one sanctioned use of `unknown`
function assertShape<T>(_value: unknown): asserts _value is T {}

function toDispositionStates(value: PlainObject[keyof PlainObject]): DispositionEntry[] {
    if (!Array.isArray(value)) return [];
    assertShape<DispositionEntry[]>(value);
    return value;
}

/**
 * Map the system's `characters` map onto the tracker's disposition map.
 *
 * The two shapes differ: the system keeps `{dispositions, relationships}` per
 * character, the tracker wants `{entity_id, states, pcAttitudes}`. `entity_id`
 * starts null and is filled in from Kanka by the caller.
 */
export function dispositionsFromCharacters(characters: PlainObject | undefined): DispositionMap {
    const out: DispositionMap = {};
    if (characters === undefined) return out;
    for (const [name, value] of Object.entries(characters)) {
        const record = asRecord(value);
        if (record === undefined) continue;
        const states = toDispositionStates(record['dispositions']);
        if (states.length === 0) continue;
        out[name] = { entity_id: null, states, pcAttitudes: {} };
    }
    return out;
}

/**
 * The graph the wh40k-rpg system has loaded, or an empty payload when it has
 * none — which on a player client is the expected outcome, because the GM-only
 * document is never sent to them.
 */
export function readSystemEventGraph(): EventGraphPayload {
    const empty: EventGraphPayload = { graph: {}, dispositions: {} };
    const tracker = readProp(readProp(game, 'wh40k'), 'EventTracker');
    if (tracker === undefined) return empty;

    const events = asRecord(readProp(tracker, 'graph'));
    if (events === undefined) return empty;
    assertShape<EventGraph>(events);

    return { graph: events, dispositions: dispositionsFromCharacters(asRecord(readProp(tracker, 'characters'))) };
}
