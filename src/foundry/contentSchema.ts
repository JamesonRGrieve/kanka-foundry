/**
 * Zod v4 content-schema validation for the wh40k-rpg item shapes this module
 * writes into a Foundry world.
 *
 * The item bridge builds a world Item by cloning a compendium base and applying
 * a Kanka-authored `foundry_variant_overrides` blob (see `itemBridge.ts`). A bad
 * override — a ranged weapon flipped to `class: "melee"`, an invalid enum — would
 * otherwise be written straight to the world and only surface as broken data in
 * play (the wh40k-rpg DataModel silently drops or normalises what it can't parse).
 * This validates the FINAL merged `system` before the write so such corruption is
 * rejected at the import boundary instead.
 *
 * The schema mirrors the system repo's authoring gate
 * (`.foundry-system/scripts/validate-pack-schema.mjs`) — kept in step by hand
 * because the two repos are independent and must not cross-link. It is scoped to
 * the corruption-prone types (`weapon`, `vehicleTrait`); other types pass.
 */
import { z } from 'zod';
import { isRecord, type PlainObject } from '../util/reflection';

/** Game-line ids that key a per-line variant container. */
const LINES: readonly string[] = ['dh1', 'dh2', 'rt', 'dw', 'bc', 'ow', 'im'];

/** A value authored plainly, OR as a per-line / per-book variant container. */
function variant(inner: z.ZodType): z.ZodType {
    // A per-line container holds a SUBSET of the lines, so it must be a PARTIAL
    // record — Zod v4's `z.record(enum, …)` is exhaustive (would require all seven).
    const lineContainer = z.record(z.string(), inner).refine((obj) => Object.keys(obj).length > 0 && Object.keys(obj).every((k) => LINES.includes(k)), {
        message: 'expected a per-line variant container keyed by game-line id',
    });
    const bookContainer = z.object({ __books: z.record(z.string(), inner), __canonical: z.string().optional() });
    return z.union([inner, lineContainer, bookContainer]);
}

// The authored value set across all six/seven lines (some line-specific / legacy
// values the DataModel normalises at load); the gate catches genuinely-new deviations.
const WEAPON_CLASS = ['melee', 'pistol', 'basic', 'heavy', 'thrown', 'exotic', 'ranged', 'vehicle', 'mounted'] as const;
const WEAPON_TYPE = [
    'primitive',
    'las',
    'solid-projectile',
    'solid_projectile',
    'bolt',
    'melta',
    'plasma',
    'flame',
    'launcher',
    'explosive',
    'power',
    'chain',
    'shock',
    'force',
    'exotic',
    'xenos',
    'energy',
    'melee',
    'shield',
    'low-tech',
    'impact',
    'grenade',
    'rending',
] as const;
const ATTACK_KIND = ['ranged', 'melee', 'thrown'] as const;
const CREW_EXPOSURE = ['', 'open', 'enclosed'] as const;

const attackShape = z.object({ type: z.enum(ATTACK_KIND).optional(), characteristic: z.string().optional() }).loose();

const weaponSystemSchema = z
    .object({
        class: variant(z.enum(WEAPON_CLASS)).nullable().optional(),
        type: variant(z.enum(WEAPON_TYPE)).nullable().optional(),
        melee: variant(z.boolean()).nullable().optional(),
        attack: variant(attackShape).nullable().optional(),
    })
    .loose();

const vehicleTraitSystemSchema = z
    .object({
        effects: z
            .object({ crewExposure: variant(z.enum(CREW_EXPOSURE)).optional() })
            .loose()
            .optional(),
    })
    .loose();

const SYSTEM_SCHEMAS = new Map<string, z.ZodType>([
    ['weapon', weaponSystemSchema],
    ['vehicleTrait', vehicleTraitSystemSchema],
]);

/** Flag a plainly-authored ranged weapon carrying a melee attack (or vice versa). */
function coherenceIssue(system: PlainObject): string | null {
    const cls = typeof system['class'] === 'string' ? system['class'] : null;
    const attack = system['attack'];
    const attackType = isRecord(attack) && typeof attack['type'] === 'string' ? attack['type'] : null;
    if (cls === null || attackType === null) return null;
    const rangedClasses = new Set(['pistol', 'basic', 'heavy']);
    if (cls === 'melee' && attackType !== 'melee') return `class "melee" but attack.type "${attackType}" (expected "melee")`;
    if (rangedClasses.has(cls) && attackType === 'melee') return `class "${cls}" (ranged) but attack.type "melee"`;
    return null;
}

/**
 * Validate an item document's `system` for the given item `type`. Returns
 * human-readable error strings ([] when clean, or when the type is not modelled).
 * @param type    The Foundry Item sub-type (`weapon`, `vehicleTrait`, …).
 * @param system  The final merged `system` payload about to be written.
 */
// eslint-disable-next-line no-restricted-syntax -- boundary: `system` is the untyped Foundry item payload; safeParse below is the validation
export function validateItemSystem(type: string, system: unknown): string[] {
    const errors: string[] = [];
    const schema = SYSTEM_SCHEMAS.get(type);
    if (schema === undefined) return errors;

    const result = schema.safeParse(system);
    if (!result.success) {
        for (const issue of result.error.issues) errors.push(`system.${issue.path.join('.')}: ${issue.message}`);
    }
    if (type === 'weapon' && isRecord(system)) {
        const coherence = coherenceIssue(system);
        if (coherence !== null) errors.push(`system: incoherent weapon — ${coherence}`);
    }
    return errors;
}
