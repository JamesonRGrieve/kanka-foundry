import { describe, expect, it } from 'vitest';
import type { KankaApiCharacter, KankaApiCharacterOrganisationLink } from '../../types/kanka';
import { buildCharacterGroups, sortByGroup } from './characterGroups';

/** Cast a partial to its full shape — test mocks populate only the fields under test. */
function mock<T>(partial: Partial<T>): T {
    return partial as T;
}

function orgLink(organisationId: number): KankaApiCharacterOrganisationLink {
    return mock<KankaApiCharacterOrganisationLink>({ organisation_id: organisationId });
}

function character(over: Partial<KankaApiCharacter>): KankaApiCharacter {
    return mock<KankaApiCharacter>({ id: 1, name: 'Someone', organisations: { data: [] }, ...over });
}

describe('buildCharacterGroups', () => {
    const families = new Map([[10, 'Edric']]);
    const orgs = new Map([[20, 'PDF Garrison']]);

    it('groups by family when the character has one', () => {
        const groups = buildCharacterGroups([character({ id: 1, families: [10] })], families, orgs);
        expect(groups.get(1)).toEqual({ name: 'Edric', type: 'family', icon: 'fa-people-roof' });
    });

    it('groups by organisation when there is no family', () => {
        const groups = buildCharacterGroups([character({ id: 1, organisations: { data: [orgLink(20)] } })], families, orgs);
        expect(groups.get(1)).toEqual({ name: 'PDF Garrison', type: 'organisation', icon: 'fa-sitemap' });
    });

    it('prefers family over organisation when both are present', () => {
        const groups = buildCharacterGroups([character({ id: 1, families: [10], organisations: { data: [orgLink(20)] } })], families, orgs);
        expect(groups.get(1)?.type).toBe('family');
    });

    it('falls through to organisation when the family id has no name (e.g. filtered-out private family)', () => {
        const groups = buildCharacterGroups([character({ id: 1, families: [999], organisations: { data: [orgLink(20)] } })], families, orgs);
        expect(groups.get(1)?.type).toBe('organisation');
    });

    it('leaves a character with neither family nor organisation ungrouped', () => {
        const groups = buildCharacterGroups([character({ id: 1 })], families, orgs);
        expect(groups.has(1)).toBe(false);
    });
});

describe('sortByGroup', () => {
    const groupFor = new Map([
        [1, { name: 'Edric', type: 'family' as const, icon: 'fa-people-roof' }],
        [2, { name: 'Edric', type: 'family' as const, icon: 'fa-people-roof' }],
        [3, { name: 'PDF Garrison', type: 'organisation' as const, icon: 'fa-sitemap' }],
    ]);

    type Row = { id: number; name: string };
    const rows: Row[] = [
        { id: 4, name: 'Zane' }, // ungrouped
        { id: 2, name: 'Kael' }, // Edric
        { id: 3, name: 'Sergeant' }, // PDF Garrison
        { id: 1, name: 'Jorl' }, // Edric
        { id: 5, name: 'Aria' }, // ungrouped
    ];

    const sorted = sortByGroup(rows, (r) => groupFor.get(r.id));

    it('orders grouped rows before ungrouped, by group then name', () => {
        expect(sorted.map((r) => r.name)).toEqual(['Jorl', 'Kael', 'Sergeant', 'Aria', 'Zane']);
    });

    it('indents grouped rows and keeps ungrouped rows at the root', () => {
        expect(sorted.map((r) => r.depth)).toEqual([1, 1, 1, 0, 0]);
    });

    it('marks the header only on the first row of each group run', () => {
        // Jorl (first Edric) → header; Kael (second Edric) → none; Sergeant (first PDF) → header;
        // ungrouped rows → never.
        expect(sorted.map((r) => r.groupHeader?.name ?? null)).toEqual(['Edric', null, 'PDF Garrison', null, null]);
    });
});
