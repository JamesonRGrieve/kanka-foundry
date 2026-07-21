import type { KankaApiCharacter } from '../../types/kanka';
import { isNonEmptyString } from '../../util/reflection';
import { idToNumber } from './hierarchy';

/**
 * The group a character is filed under in the import browser: its family if it
 * has one, otherwise the organisation it belongs to. Kanka stores no
 * character→character parent (see {@link ./hierarchy}), so this cross-type key
 * is the only structure the otherwise-flat character list can be given.
 *
 * `icon` is the FontAwesome class the list header renders — carried on the model
 * so the template stays free of type→icon branching (this module is a
 * browser-presentation concern, not domain data).
 */
export type CharacterGroup = { name: string; type: 'family' | 'organisation'; icon: string };

const FAMILY_ICON = 'fa-people-roof';
const ORGANISATION_ICON = 'fa-sitemap';

/** The primary family id: the first of the `related=1` `families[]` list. (The
 *  deprecated singular `family_id` is intentionally not read — the import
 *  browser loads characters with `related=1`, which always populates `families`.) */
function primaryFamilyId(character: KankaApiCharacter): number | null {
    const first = character.families?.[0];
    return typeof first === 'number' ? first : null;
}

/** The primary organisation id: the first organisation the character is linked to. */
function primaryOrganisationId(character: KankaApiCharacter): number | null {
    const first = character.organisations.data.at(0)?.organisation_id;
    return typeof first === 'number' ? first : null;
}

/**
 * Resolve each character to its browser group. `familyNames` / `organisationNames`
 * are `childId → name` maps built from the campaign's family / organisation
 * entities. A membership id absent from its name map (e.g. a private family the
 * entity list filtered out) is skipped, falling through family → organisation →
 * ungrouped. Characters with neither are absent from the returned map and render
 * ungrouped at the root.
 */
export function buildCharacterGroups(
    characters: readonly KankaApiCharacter[],
    familyNames: ReadonlyMap<number, string>,
    organisationNames: ReadonlyMap<number, string>,
): Map<number, CharacterGroup> {
    const groups = new Map<number, CharacterGroup>();

    for (const character of characters) {
        const childId = idToNumber(character.id);
        if (childId === null) continue;

        const familyId = primaryFamilyId(character);
        const familyName = familyId !== null ? familyNames.get(familyId) : undefined;
        if (isNonEmptyString(familyName)) {
            groups.set(childId, { name: familyName, type: 'family', icon: FAMILY_ICON });
            continue;
        }

        const orgId = primaryOrganisationId(character);
        const orgName = orgId !== null ? organisationNames.get(orgId) : undefined;
        if (isNonEmptyString(orgName)) {
            groups.set(childId, { name: orgName, type: 'organisation', icon: ORGANISATION_ICON });
        }
    }

    return groups;
}

/** A character row decorated for the grouped import list. */
export type GroupedRow<T> = T & {
    /** Indentation level: 1 for a grouped character (under its header), 0 when ungrouped. */
    depth: number;
    /** The row's group, or null when the character belongs to no family/organisation. */
    group: CharacterGroup | null;
    /** The group header to render ABOVE this row — set only on the first member of
     *  each contiguous group run, null otherwise (and always null for ungrouped rows). */
    groupHeader: CharacterGroup | null;
};

/**
 * Order characters into their groups and mark where each group's header belongs.
 * Grouped characters come first (ordered by group name, then character name) and
 * are indented one level; ungrouped characters follow, sorted by name, at the
 * root. `groupHeader` is set on the first row of each group run so the list view
 * can render one header line per group without any separate header elements —
 * keeping the returned rows homogeneous (each a real entity) so counts and the
 * link/update actions are unaffected. The grid view simply ignores `groupHeader`.
 */
export function sortByGroup<T extends { name: string }>(entities: readonly T[], groupOf: (entity: T) => CharacterGroup | undefined): Array<GroupedRow<T>> {
    const decorated: Array<GroupedRow<T>> = entities.map((entity) => {
        const group = groupOf(entity) ?? null;
        return { ...entity, group, depth: group ? 1 : 0, groupHeader: null };
    });

    decorated.sort((a, b) => {
        if (a.group && b.group) {
            const byGroup = a.group.name.localeCompare(b.group.name);
            if (byGroup !== 0) return byGroup;
        } else if (a.group) {
            return -1;
        } else if (b.group) {
            return 1;
        }
        return a.name.localeCompare(b.name);
    });

    let lastGroupName: string | null = null;
    for (const row of decorated) {
        row.groupHeader = row.group && row.group.name !== lastGroupName ? row.group : null;
        lastGroupName = row.group?.name ?? null;
    }

    return decorated;
}
