import { describe, expect, it } from 'vitest';
import EntityType from '../../types/EntityType';
import {
    type Decorated,
    HIERARCHY_PARENT_FIELDS,
    type HierarchyMeta,
    buildAncestorPath,
    buildHierarchyMeta,
    idToNumber,
    isHierarchicalType,
    sortByHierarchy,
} from './hierarchy';

describe('idToNumber', () => {
    it('passes through numbers', () => {
        expect(idToNumber(42)).toBe(42);
    });

    it('coerces numeric strings', () => {
        expect(idToNumber('42')).toBe(42);
    });

    it('returns null for null, undefined and non-numeric input', () => {
        expect(idToNumber(null)).toBeNull();
        expect(idToNumber(undefined)).toBeNull();
        expect(idToNumber('abc')).toBeNull();
    });
});

describe('isHierarchicalType', () => {
    it('treats tree types as hierarchical', () => {
        expect(isHierarchicalType(EntityType.location)).toBe(true);
        expect(isHierarchicalType(EntityType.organisation)).toBe(true);
        expect(isHierarchicalType(EntityType.family)).toBe(true);
    });

    it('treats characters as non-hierarchical (no native parent link in Kanka)', () => {
        expect(isHierarchicalType(EntityType.character)).toBe(false);
    });
});

describe('buildHierarchyMeta', () => {
    it('reads the first available parent field per type', () => {
        const meta = buildHierarchyMeta(
            [
                { id: 1, name: 'Root', location_id: null },
                { id: 2, name: 'Child', location_id: 1 },
                // Falls back to the deprecated parent_location_id when location_id is absent
                { id: 3, name: 'Legacy', parent_location_id: 1 },
            ],
            HIERARCHY_PARENT_FIELDS[EntityType.location] ?? [],
        );

        expect(meta.get(1)).toEqual({ parentId: null, name: 'Root' });
        expect(meta.get(2)).toEqual({ parentId: 1, name: 'Child' });
        expect(meta.get(3)).toEqual({ parentId: 1, name: 'Legacy' });
    });

    it('coerces string ids and skips entries without an id', () => {
        const meta = buildHierarchyMeta(
            [
                { id: '10', name: 'Org', organisation_id: '5' },
                { name: 'No id', organisation_id: 5 },
            ],
            HIERARCHY_PARENT_FIELDS[EntityType.organisation] ?? [],
        );

        expect(meta.size).toBe(1);
        expect(meta.get(10)).toEqual({ parentId: 5, name: 'Org' });
    });
});

describe('buildAncestorPath', () => {
    const meta: HierarchyMeta = new Map([
        [1, { parentId: null, name: 'System' }],
        [2, { parentId: 1, name: 'Planet' }],
        [3, { parentId: 2, name: 'District' }],
    ]);

    it('returns the root → node name path', () => {
        expect(buildAncestorPath(meta, 3)).toEqual(['System', 'Planet', 'District']);
    });

    it('returns an empty path for a null or unknown start', () => {
        expect(buildAncestorPath(meta, null)).toEqual([]);
        expect(buildAncestorPath(meta, 999)).toEqual([]);
    });

    it('is cycle-guarded', () => {
        const cyclic: HierarchyMeta = new Map([
            [1, { parentId: 2, name: 'A' }],
            [2, { parentId: 1, name: 'B' }],
        ]);
        // Terminates and includes each node at most once.
        expect(buildAncestorPath(cyclic, 1)).toEqual(['B', 'A']);
    });
});

describe('sortByHierarchy', () => {
    it('places children under their parent and shallow before deep', () => {
        const decorated: Array<Decorated<{ name: string }>> = [
            { entity: { name: 'District' }, depth: 2, sortPath: ['System', 'Planet', 'District'] },
            { entity: { name: 'System' }, depth: 0, sortPath: ['System'] },
            { entity: { name: 'Planet' }, depth: 1, sortPath: ['System', 'Planet'] },
            { entity: { name: 'Other' }, depth: 0, sortPath: ['Other'] },
        ];

        const sorted = sortByHierarchy(decorated);

        expect(sorted.map((entry) => entry.name)).toEqual(['Other', 'System', 'Planet', 'District']);
        expect(sorted.map((entry) => entry.depth)).toEqual([0, 0, 1, 2]);
    });
});
