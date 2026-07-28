/**
 * @file Per-character advancements over a canonical base actor (dh-campaign#34).
 *
 * Every vault character rides its base actor unmodified: 89 of 93 carry a
 * `canonical_sheet` and all 89 have `advancements: []`. So a named NPC's sheet is
 * exactly whatever bestiary entry it points at — a PDF Commander with no Command
 * and no Common Lore, because the base is a rank-and-file hybrid.
 *
 * `canonical_sheet.advancements` was always the intended override channel, but
 * nothing carried it: the vault importer wrote only `base_actor`, `base_items`
 * and `token_frame`, and this plugin read only those. This module is the missing
 * half — it turns the authored advancements into an actor update applied OVER the
 * base, which is the "per-character advancements win" the base-actor merge
 * already promises in its own doc comment.
 *
 * Pure: it produces the update payload and writes nothing, so the mapping is
 * testable without a world.
 */

import { type PlainObject, asRecord } from '../util/reflection';

/** A characteristic advance — N steps of +5 over the base's value. */
interface CharacteristicAdvancement {
    type: 'characteristic';
    /** Foundry characteristic key (`weaponSkill`, `fellowship`, …). */
    characteristic: string;
    /** Number of advances. Each is +5 in the d100 lines. */
    advance: number;
}

/** A skill advance. `specialisation` names an entry on a specialist skill. */
interface SkillAdvancement {
    type: 'skill';
    /** Foundry skill key (`command`, `commonLore`, …) — the `system.skills` key. */
    skill: string;
    /** For specialist skills: which specialisation. Must be one the skill declares. */
    specialisation?: string;
    /** Rank: 1 = Known, 2 = Trained, 3 = Experienced, 4 = Veteran. */
    advance: number;
}

export type Advancement = CharacteristicAdvancement | SkillAdvancement;

/** Points added per characteristic advance in the d100 lines. */
const CHARACTERISTIC_STEP = 5;

/** A skill entry as `system.skills.<key>.entries` holds it. */
interface SkillEntry {
    name: string;
    slug: string;
    advance: number;
    bonus: number;
    cost: number;
}

/**
 * Slug for a specialisation, matching the system's own `specializationSlug`:
 * lowercase, punctuation and whitespace folded to single hyphens.
 *
 * The roll engine matches a specialisation by name OR slug, so the two must agree
 * — writing a slug the engine cannot reproduce is how a specialisation ends up
 * owned but unmatched (wh40k#225).
 * @param {string} name  The specialisation's display name.
 * @returns {string}  Its slug.
 */
export function specialisationSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** True when the value is a well-formed advancement entry. */
function isAdvancement(value: PlainObject[keyof PlainObject]): value is Advancement & PlainObject {
    const record = asRecord(value);
    if (record === undefined) return false;
    const advance = record['advance'];
    if (typeof advance !== 'number' || !Number.isFinite(advance) || advance <= 0) return false;
    if (record['type'] === 'characteristic') return typeof record['characteristic'] === 'string' && record['characteristic'] !== '';
    if (record['type'] === 'skill') return typeof record['skill'] === 'string' && record['skill'] !== '';
    return false;
}

/**
 * Parse the authored advancements, dropping anything malformed.
 *
 * Degrades entry-by-entry rather than rejecting the list: one mis-authored line
 * in a character file must not silently cost that character every other advance
 * it was given.
 * @param {unknown} raw  The parsed `advancements` attribute.
 * @returns {Advancement[]}  The well-formed entries.
 */
// eslint-disable-next-line no-restricted-syntax -- boundary: the attribute arrives as untyped JSON from Kanka; this function IS the validation
export function parseAdvancements(raw: unknown): Advancement[] {
    if (!Array.isArray(raw)) return [];
    const out: Advancement[] = [];
    for (const value of raw) {
        if (!isAdvancement(value)) continue;
        out.push(
            value.type === 'characteristic'
                ? { type: 'characteristic', characteristic: value.characteristic, advance: value.advance }
                : {
                      type: 'skill',
                      skill: value.skill,
                      advance: value.advance,
                      ...(typeof value.specialisation === 'string' && value.specialisation !== '' ? { specialisation: value.specialisation } : {}),
                  },
        );
    }
    return out;
}

/**
 * The actor `system` patch these advancements imply, applied over `baseSystem`.
 *
 * Advances are ADDITIVE over the base: the base actor supplies the profile and
 * the advancements say how this particular character differs from it, which is
 * the whole point of the canonical-sheet model (the vault stores *only*
 * overrides). A specialist skill's specialisation is appended to `entries`
 * rather than replacing them, so a base that already grants one keeps it.
 * @param {Advancement[]} advancements  The authored advances.
 * @param {PlainObject} baseSystem  The base actor's system data.
 * @returns {PlainObject}  A patch to merge over `baseSystem`.
 */
// eslint-disable-next-line no-restricted-syntax -- boundary: Foundry actor system payloads are open-ended Records at this seam
export function advancementsToSystemPatch(advancements: Advancement[], baseSystem: PlainObject): PlainObject {
    // eslint-disable-next-line no-restricted-syntax -- boundary: the patch is a Foundry update payload
    const characteristics: Record<string, { advance: number; total: number }> = {};
    // eslint-disable-next-line no-restricted-syntax -- boundary: the patch is a Foundry update payload
    const skills: Record<string, { advance?: number; entries?: SkillEntry[] }> = {};

    const baseCharacteristics = asRecord(baseSystem['characteristics']) ?? {};
    const baseSkills = asRecord(baseSystem['skills']) ?? {};

    for (const adv of advancements) {
        if (adv.type === 'characteristic') {
            const existing = asRecord(baseCharacteristics[adv.characteristic]);
            const baseValue = typeof existing?.['total'] === 'number' ? existing['total'] : 0;
            const baseAdvance = typeof existing?.['advance'] === 'number' ? existing['advance'] : 0;
            characteristics[adv.characteristic] = {
                advance: baseAdvance + adv.advance,
                total: baseValue + adv.advance * CHARACTERISTIC_STEP,
            };
            continue;
        }

        const existingSkill = asRecord(baseSkills[adv.skill]);
        if (adv.specialisation === undefined) {
            skills[adv.skill] = { advance: adv.advance };
            continue;
        }

        // Specialist skill: append the specialisation, keeping whatever the base
        // already granted. Re-authoring one the base has bumps it instead of
        // adding a second track the roll engine would see as a different skill.
        const slug = specialisationSlug(adv.specialisation);
        const priorRaw = Array.isArray(existingSkill?.['entries']) ? existingSkill['entries'] : [];
        const prior: SkillEntry[] = [];
        let bumped = false;
        for (const entry of priorRaw) {
            const record = asRecord(entry);
            if (record === undefined) continue;
            const name = typeof record['name'] === 'string' ? record['name'] : '';
            const entrySlug = typeof record['slug'] === 'string' && record['slug'] !== '' ? record['slug'] : specialisationSlug(name);
            const advance = typeof record['advance'] === 'number' ? record['advance'] : 0;
            const bonus = typeof record['bonus'] === 'number' ? record['bonus'] : 0;
            const cost = typeof record['cost'] === 'number' ? record['cost'] : 0;
            if (entrySlug === slug) {
                bumped = true;
                prior.push({ name, slug: entrySlug, advance: Math.max(advance, adv.advance), bonus, cost });
            } else {
                prior.push({ name, slug: entrySlug, advance, bonus, cost });
            }
        }
        // Merge against what previous advancements in THIS list already added, so
        // two entries for the same skill accumulate rather than overwrite.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- boundary: parser mismatch; the index signature types this as always-defined, but a skill not yet staged in this loop genuinely is undefined at runtime
        const merged = skills[adv.skill]?.entries ?? prior;
        if (!bumped && !merged.some((e) => e.slug === slug)) {
            merged.push({ name: adv.specialisation, slug, advance: adv.advance, bonus: 0, cost: 0 });
        }
        skills[adv.skill] = { ...skills[adv.skill], entries: merged };
    }

    const patch: PlainObject = {};
    if (Object.keys(characteristics).length > 0) patch['characteristics'] = characteristics;
    if (Object.keys(skills).length > 0) patch['skills'] = skills;
    return patch;
}
