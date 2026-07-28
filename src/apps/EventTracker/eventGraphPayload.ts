/**
 * Shape of the campaign event graph as the tracker consumes it.
 *
 * The graph is authored in the vault, exported by `export_events.py`, and
 * delivered through the wh40k-rpg system, which loads it from a GM-only
 * JournalEntry (dh-campaign#33). Nothing about the shape is guaranteed at that
 * boundary, so the structural narrowing lives in `systemEventGraph.ts` and every
 * branch there degrades to an empty value rather than throwing — one malformed
 * NPC never costs the GM the whole graph.
 *
 * This module is types only. The parser that used to live here decoded the
 * Kanka `event_graph` attribute, which is retired: the payload outgrew Kanka's
 * 65,535-char attribute cap, and the graph is GM-secret, so it no longer travels
 * through Kanka at all.
 */

import type { KankaApiEntityId } from '../../types/kanka';

/**
 * A requirement node in the dependency tree.
 * - null: no dependencies (always satisfied)
 * - string: a single event ID (leaf)
 * - {any: RequirementNode[]}: at least one child must be resolved
 * - {all: RequirementNode[]}: every child must be resolved
 */
export type RequirementNode = null | string | { any: RequirementNode[] } | { all: RequirementNode[] };

export interface EventGraphNode {
    name: string;
    source: string;
    location?: string;
    /** Dependency tree. null = no dependencies. For legacy data, may be an array (treated as implicit all). */
    requires?: RequirementNode | RequirementNode[];
    /** Legacy flat OR — normalised into requires on load. */
    requires_any?: string[] | null;
    excuse?: Record<string, string>;
    is_day_end?: boolean;
}

export type EventGraph = Record<string, EventGraphNode>;

export interface DispositionEntry {
    default?: boolean;
    trigger?: string;
    attitude: string;
    note: string;
}

export interface NpcDisposition {
    /** Kanka entity id, resolved by name at load time — the vault has no Kanka ids. */
    entity_id: KankaApiEntityId | null;
    states: DispositionEntry[];
    /** Per-PC attitudes loaded from Kanka entity attributes. Key = PC name, value = free text. */
    pcAttitudes: Record<string, string>;
}

export type DispositionMap = Record<string, NpcDisposition>;

export interface EventGraphPayload {
    graph: EventGraph;
    dispositions: DispositionMap;
}
