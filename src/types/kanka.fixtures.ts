/**
 * Complete Kanka API fixtures for tests.
 *
 * Kanka entities carry a large envelope (blame stamps, relation collections,
 * URL pairs) that no test cares about, which is why they used to be faked with
 * `partial as T`. That cast defeats the type system exactly where it is most
 * useful — a fixture that has drifted from the interface still compiles, and
 * the test passes against a shape the API never returns.
 *
 * These builders fill the envelope with empty defaults and spread the caller's
 * overrides on top, so a fixture is a real, fully-typed entity and a change to
 * the interface fails the build here rather than silently in production.
 */

import type { KankaApiCharacter, KankaApiCharacterOrganisationLink, KankaApiChildEntity, KankaApiEntityId, KankaApiId, KankaApiMap } from './kanka';

/** The blame/visibility/relation envelope every child entity carries. */
function childEntityBase(id: KankaApiId, entityId: KankaApiEntityId, name: string): KankaApiChildEntity {
    return {
        id,
        entity_id: entityId,
        name,
        entry: '',
        entry_parsed: '',
        urls: { view: '', api: '' },
        attributes: [],
        relations: [],
        inventory: [],
        posts: [],
        entity_abilities: [],
        reminders: [],
        entity_assets: [],
        is_private: false,
        created_at: '',
        created_by: 0,
        updated_at: '',
        updated_by: 0,
    };
}

export function createKankaMap(overrides: Partial<KankaApiMap> = {}): KankaApiMap {
    return {
        ...childEntityBase(7, 700, 'Solenne Minoris'),
        location_id: 42,
        is_real: false,
        image_full: 'https://kanka.example/maps/solenne.webp',
        ...overrides,
    };
}

export function createKankaCharacter(overrides: Partial<KankaApiCharacter> = {}): KankaApiCharacter {
    return {
        ...childEntityBase(1, 100, 'Someone'),
        title: null,
        age: null,
        sex: null,
        pronouns: null,
        type: null,
        is_dead: false,
        traits: [],
        is_personality_visible: false,
        is_personality_pinned: false,
        is_appearance_pinned: false,
        organisations: { data: [] },
        ...overrides,
    };
}

export function createKankaOrganisationLink(organisationId: KankaApiId): KankaApiCharacterOrganisationLink {
    return {
        id: organisationId,
        character_id: 1,
        organisation_id: organisationId,
        is_private: false,
    };
}
