/**
 * What of a Kanka entity a Foundry document keeps (wh40k-rpg#739).
 *
 * The sync writes Kanka content INTO Foundry documents: a post page's text is the
 * page's own `text.content`, a list page holds its list. Documents used to carry a
 * whole copy of the entity besides (every post page, the overview page, the journal
 * flag, the actor flag), which put tens of megabytes into the world payload every
 * client downloads before `init`. A document now keeps only what is read back:
 *
 * - the journal and actor `snapshot` flag: a small reference (name, ids, image, link,
 *   quest state), read by the directory, reference links, "Open in Kanka", re-import
 *   and quest sync-back;
 * - the overview page: the fields its templates render (`OVERVIEW_SNAPSHOT_FIELDS`;
 *   a test holds the list to the templates);
 * - a post page: nothing, as its sheet renders `text.content`.
 */
import type { KankaApiChildEntity } from '../types/kanka';

function assertType<T>(_value: unknown): asserts _value is T {}

/** The entity fields the journal / actor `snapshot` flag keeps. */
export const ENTITY_REFERENCE_FIELDS = ['id', 'entity_id', 'name', 'is_completed', 'has_custom_image', 'image_full', 'image_thumb', 'urls'] as const;

/** The `snapshot` flag: the part of a Kanka entity its readers use. */
export type EntityReference = Partial<Pick<KankaApiChildEntity, 'id' | 'entity_id' | 'name' | 'has_custom_image' | 'image_full' | 'image_thumb' | 'urls'>> & {
    is_completed?: boolean;
};

/**
 * The entity fields an overview page renders: the fields its templates read
 * (`apps/KankaJournal/pages/*-overview.hbs` and `shared/*.hbs`), plus those
 * `KankaPageModel.prepareDerivedData` derives them from (`entity_events`,
 * `character_id`) and the `parents` chain the sheet reverses.
 */
export const OVERVIEW_SNAPSHOT_FIELDS = [
    'age',
    'attributes',
    'author_id',
    'calendar_day',
    'calendar_id',
    'calendar_month',
    'calendar_reminder_length',
    'calendar_year',
    'character_id',
    'charges',
    'creator_id',
    'date',
    'entity_events',
    'families',
    'instigator_id',
    'is_completed',
    'is_dead',
    'is_defunct',
    'is_destroyed',
    'is_extinct',
    'location_id',
    'locations',
    'members',
    'organisations',
    'parents',
    'price',
    'pronouns',
    'races',
    'relations',
    'reminders',
    'sex',
    'size',
    'title',
    'type',
    'weight',
] as const;

/** The listed fields of `entity` that it carries, and no others. */
function pick(entity: object, fields: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
        if (field in entity) out[field] = Reflect.get(entity, field);
    }
    return out;
}

/** The `snapshot` flag a journal or actor keeps for `entity`. */
export function entityReference(entity: object): EntityReference {
    const reference: unknown = pick(entity, ENTITY_REFERENCE_FIELDS);
    assertType<EntityReference>(reference);
    return reference;
}

/** The snapshot an overview page keeps for `entity`. */
export function overviewSnapshot(entity: object): Record<string, unknown> {
    return pick(entity, OVERVIEW_SNAPSHOT_FIELDS);
}

/** The part of `foundry.data.operators` this module uses; the V14 typings don't declare it yet. */
interface ReplacementOperators {
    ForcedReplacement: { create: <T>(value: T) => T };
}

/**
 * `value` wrapped so a document update assigns it outright. An update otherwise
 * merges objects key by key, so a smaller snapshot written over a whole-entity one
 * would keep every old key.
 */
export function replacing<T>(value: T): T {
    if (typeof foundry === 'undefined') return value;
    const operators: unknown = Reflect.get(foundry.data, 'operators');
    assertType<ReplacementOperators | undefined>(operators);
    return operators === undefined ? value : operators.ForcedReplacement.create(value);
}
