/**
 * Shared stub factories for type loader tests.
 * These create fully-typed objects satisfying interface requirements
 * without requiring unsafe `as T` casts on partial literals.
 */

import { KankaVisibility } from '../../types/kanka';
import type {
    KankaApiAbilityLink,
    KankaApiCharacterOrganisationLink,
    KankaApiEntityId,
    KankaApiId,
    KankaApiInventory,
    KankaApiQuestElement,
    KankaApiRelation,
} from '../../types/kanka';

export function stubRelation(target_id: KankaApiEntityId): KankaApiRelation {
    return { id: 0, owner_id: 0, target_id, is_star: false, visibility_id: KankaVisibility.all };
}

export function stubInventory(item_id: KankaApiId): KankaApiInventory {
    return {
        id: 0,
        amount: 1,
        is_equipped: false,
        item_id,
        name: '',
        visibility_id: KankaVisibility.all,
    };
}

export function stubAbilityLink(ability_id: KankaApiId): KankaApiAbilityLink {
    return { id: 0, charges: null, ability_id, note: null, position: 0, visibility_id: KankaVisibility.all };
}

export function stubCharacterOrgLink(organisation_id: KankaApiId): KankaApiCharacterOrganisationLink {
    return { id: 0, character_id: 0, organisation_id, is_private: false };
}

export function stubOrgMemberLink(character_id: KankaApiId): KankaApiCharacterOrganisationLink {
    return { id: 0, character_id, organisation_id: 0, is_private: false };
}

export function stubQuestElement(entity_id: KankaApiEntityId): KankaApiQuestElement {
    return {
        id: 0,
        name: '',
        entity_id,
        colour: null,
        entry: '',
        entry_parsed: null,
        role: null,
        visibility_id: KankaVisibility.all,
    };
}
