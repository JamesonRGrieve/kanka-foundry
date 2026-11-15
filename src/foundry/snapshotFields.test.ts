import { describe, expect, it } from 'vitest';
import trimMigration, { trimmedFlagSnapshot, trimmedPageSnapshot } from '../migrations/2026-11-14-trim-snapshots';
import starredRelationsMigration from '../migrations/2026-11-15-starred-relations';
import { ENTITY_REFERENCE_FIELDS, entityReference, OVERVIEW_SNAPSHOT_FIELDS, overviewSnapshot } from './snapshotFields';

const overviewTemplates = import.meta.glob(['../apps/KankaJournal/pages/*-overview.hbs', '../apps/KankaJournal/shared/*.hbs'], {
    eager: true,
    query: '?raw',
    import: 'default',
});

/** A whole Kanka entity as the API returns it, cut down to a few representative keys. */
const ENTITY = {
    id: 7,
    entity_id: 70,
    name: 'Hab District 4',
    is_completed: false,
    has_custom_image: true,
    image_full: 'https://wiki.example/full.png',
    image_thumb: 'https://wiki.example/thumb.png',
    urls: { view: 'https://wiki.example/entities/70' },
    entry_parsed: '<p>A long entry.</p>',
    posts: [{ id: 1, entry_parsed: '<p>A post.</p>' }],
    relations: [{ target_id: 3, is_star: true }],
    type: 'Hab block',
};

describe('the overview snapshot (wh40k-rpg#739)', () => {
    it('holds every field an overview template reads', () => {
        const read = new Set<string>();
        for (const source of Object.values(overviewTemplates)) {
            if (typeof source !== 'string') continue;
            for (const match of source.matchAll(/snapshot\.([a-zA-Z_]+)/gu)) if (match[1] !== undefined) read.add(match[1]);
        }
        expect(read.size).toBeGreaterThan(20);
        const listed: readonly string[] = OVERVIEW_SNAPSHOT_FIELDS;
        expect([...read].filter((field) => !listed.includes(field))).toEqual([]);
    });

    it('keeps those fields and drops the rest of the entity', () => {
        expect(overviewSnapshot(ENTITY)).toEqual({ relations: ENTITY.relations, type: 'Hab block', is_completed: false });
    });

    it('keeps only the starred relations, the ones the overview shows', () => {
        const family = { ...ENTITY, relations: [{ target_id: 3, is_star: true }, { target_id: 4, is_star: false }, { target_id: 5 }] };
        expect(overviewSnapshot(family)['relations']).toEqual([{ target_id: 3, is_star: true }]);
    });
});

describe('the snapshot flag reference', () => {
    it('keeps the fields its readers use, and nothing else', () => {
        const reference = entityReference(ENTITY);
        expect(Object.keys(reference).sort()).toEqual([...ENTITY_REFERENCE_FIELDS].sort());
        expect(reference).toMatchObject({ id: 7, name: 'Hab District 4', urls: { view: 'https://wiki.example/entities/70' } });
    });
});

describe('the trim migration', () => {
    it('empties a post page snapshot and trims an overview one', () => {
        expect(trimmedPageSnapshot({ id: 'a', type: 'kanka-foundry.post', snapshot: ENTITY })).toEqual({});
        expect(trimmedPageSnapshot({ id: 'b', type: 'kanka-foundry.overview', snapshot: ENTITY })).toEqual(overviewSnapshot(ENTITY));
    });

    it('leaves list pages, already-trimmed pages and absent snapshots alone', () => {
        expect(trimmedPageSnapshot({ id: 'c', type: 'kanka-foundry.relations', snapshot: { list: [] } })).toBeNull();
        expect(trimmedPageSnapshot({ id: 'd', type: 'kanka-foundry.post', snapshot: {} })).toBeNull();
        expect(trimmedPageSnapshot({ id: 'e', type: 'kanka-foundry.overview', snapshot: overviewSnapshot(ENTITY) })).toBeNull();
        expect(trimmedPageSnapshot({ id: 'f', type: 'kanka-foundry.overview', snapshot: undefined })).toBeNull();
    });

    it('cuts a whole-entity flag to the reference, once', () => {
        expect(trimmedFlagSnapshot(ENTITY)).toEqual({ ...entityReference(ENTITY) });
        expect(trimmedFlagSnapshot(entityReference(ENTITY))).toBeNull();
        expect(trimmedFlagSnapshot(undefined)).toBeNull();
    });

    it('cuts an already-trimmed overview whose relations still hold unstarred ones', () => {
        const kept = {
            relations: [
                { target_id: 3, is_star: true },
                { target_id: 4, is_star: false },
            ],
            type: 'Hab block',
        };
        expect(trimmedPageSnapshot({ id: 'g', type: 'kanka-foundry.overview', snapshot: kept })).toEqual({
            relations: [{ target_id: 3, is_star: true }],
            type: 'Hab block',
        });
    });

    it('is a migration module, re-run by the starred-relations migration', () => {
        expect(typeof trimMigration).toBe('function');
        expect(starredRelationsMigration).toBe(trimMigration);
    });
});
