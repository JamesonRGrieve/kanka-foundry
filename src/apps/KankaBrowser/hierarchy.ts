import EntityType from '../../types/EntityType';
import { readProp, readString } from '../../util/reflection';

type HierarchyNode = { parentId: number | null; name: string };
export type HierarchyMeta = Map<number, HierarchyNode>;

/**
 * Kanka entity types that have a native parent/child tree, mapped to the
 * self-referential parent field(s) on their list payload. These fields live in
 * the same id-space as `id` (the type's child id), so a parent reference can be
 * looked up directly in the meta map built from the same list. Fields are tried
 * in order; the first non-null one wins (older API payloads only expose the
 * deprecated single-parent field, e.g. `location_id`).
 *
 * Characters are intentionally absent: Kanka stores no character-to-character
 * parent link, so characters cannot be nested by ancestry. They are reached
 * through their organisation/family/location — all of which appear here.
 */
export const HIERARCHY_PARENT_FIELDS: Partial<Record<EntityType, readonly string[]>> = {
    [EntityType.location]: ['location_id', 'parent_location_id'],
    [EntityType.organisation]: ['organisation_id'],
    [EntityType.family]: ['family_id'],
    [EntityType.item]: ['item_id'],
    [EntityType.journal]: ['journal_id'],
    [EntityType.note]: ['note_id'],
    [EntityType.quest]: ['quest_id'],
    [EntityType.race]: ['race_id'],
    [EntityType.event]: ['event_id'],
    [EntityType.creature]: ['creature_id'],
    [EntityType.ability]: ['ability_id'],
};

export function isHierarchicalType(type: EntityType): boolean {
    return type in HIERARCHY_PARENT_FIELDS;
}

// eslint-disable-next-line no-restricted-syntax -- boundary: Kanka ids arrive as a number or numeric string from JSON; narrowed below
export function idToNumber(id: unknown): number | null {
    if (typeof id === 'number') return Number.isNaN(id) ? null : id;
    if (typeof id === 'string') {
        const value = Number(id);
        return Number.isNaN(value) ? null : value;
    }
    return null;
}

function readId(node: object, field: string): number | null {
    return idToNumber(readProp(node, field));
}

/**
 * Build a `childId → { parentId, name }` map from a type's `related=1` list
 * payload. `parentFields` is the entry from {@link HIERARCHY_PARENT_FIELDS} for
 * that type. Entries without a usable id are skipped.
 */
export function buildHierarchyMeta(list: ReadonlyArray<object>, parentFields: readonly string[]): HierarchyMeta {
    const map: HierarchyMeta = new Map();

    for (const node of list) {
        const id = readId(node, 'id');
        if (id === null) continue;

        let parentId: number | null = null;
        for (const field of parentFields) {
            const value = readId(node, field);
            if (value !== null) {
                parentId = value;
                break;
            }
        }

        map.set(id, { parentId, name: readString(node, 'name') ?? '' });
    }

    return map;
}

/**
 * Walk `parentId` from `startId` up to the root, returning the ancestor name
 * path ordered root → startId. Cycle-guarded, and stops at the first id that is
 * missing from `meta` (e.g. a parent that was filtered out as private). Returns
 * an empty array when `startId` is null or absent from `meta`.
 */
export function buildAncestorPath(meta: HierarchyMeta, startId: number | null): string[] {
    const path: string[] = [];
    const seen = new Set<number>();
    let currentId = startId;

    while (currentId !== null && !seen.has(currentId)) {
        seen.add(currentId);
        const node = meta.get(currentId);
        if (!node) break;
        path.unshift(node.name);
        currentId = node.parentId;
    }

    return path;
}

export type Decorated<T> = { entity: T; depth: number; sortPath: readonly string[] };

/**
 * Stable hierarchical ordering: sort by ancestor path component-by-component so
 * children follow their parent, with shallower paths before deeper ones on a
 * shared prefix. Returns each entity decorated with its `depth` for the
 * indentation rendered by the import-browser list template.
 */
export function sortByHierarchy<T>(decorated: Array<Decorated<T>>): Array<T & { depth: number }> {
    decorated.sort((a, b) => {
        const len = Math.min(a.sortPath.length, b.sortPath.length);
        for (let i = 0; i < len; i += 1) {
            const cmp = (a.sortPath[i] ?? '').localeCompare(b.sortPath[i] ?? '');
            if (cmp !== 0) return cmp;
        }
        return a.sortPath.length - b.sortPath.length;
    });

    return decorated.map(({ entity, depth }) => ({ ...entity, depth }));
}
