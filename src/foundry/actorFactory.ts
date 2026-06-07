import type { KankaApiAttribute, KankaApiCharacter, KankaApiEntityId, KankaApiId } from '../types/kanka';
import { BIO_MAP, CHARACTERISTIC_MAP, ORIGIN_MAP, ROOT_STRING_MAP, STAT_MAP } from './actorAttributeMaps';
import { syncTokenImage } from './tokenImage';

function getAttributeValue(attributes: KankaApiAttribute[], name: string): number | null {
    const attr = attributes.find((a) => a.name === name);
    if (!attr?.value) return null;
    const num = Number(attr.value);
    return Number.isNaN(num) ? null : num;
}

function getStringAttribute(attributes: KankaApiAttribute[], name: string): string {
    return attributes.find((a) => a.name === name)?.value ?? '';
}

function buildCharacteristics(attributes: KankaApiAttribute[]): Record<string, { base: number }> {
    const characteristics: Record<string, { base: number }> = {};
    for (const [kankaName, foundryKey] of Object.entries(CHARACTERISTIC_MAP)) {
        const value = getAttributeValue(attributes, kankaName);
        if (value !== null) {
            characteristics[foundryKey] = { base: value };
        }
    }
    return characteristics;
}

function buildSystemStats(attributes: KankaApiAttribute[]): Record<string, unknown> {
    const stats: Record<string, unknown> = {};
    for (const [kankaName, foundryPath] of Object.entries(STAT_MAP)) {
        const value = getAttributeValue(attributes, kankaName);
        if (value === null) continue;

        const parts = foundryPath.split('.');
        if (parts.length === 2) {
            const group = parts[0];
            const field = parts[1];
            if (!group || !field) continue;
            if (!stats[group] || typeof stats[group] !== 'object') {
                stats[group] = {};
            }
            const groupObj = stats[group];
            if (groupObj !== null && typeof groupObj === 'object') {
                Reflect.set(groupObj, field, value);
            }
        } else {
            stats[foundryPath] = value;
        }
    }
    return stats;
}

/**
 * Compose the Foundry actor type from the active wh40k-rpg game system
 * (bc/dh1/dh2/dw/ow/rt/im) and the actor kind (character/npc/vehicle).
 * Result format: `<system>-<kind>` — e.g. `dh2-npc`. The wh40k-rpg system
 * registers all actor types in this shape; bare kinds like 'npc' yield a
 * "broken empty default" sheet because no DataModel matches.
 */
function determineActorType(_entity: KankaApiCharacter, entityTags: string[], defaultKind: string, pcTags: string[], gameSystem: string): string {
    const lowerTags = entityTags.map((t) => t.toLowerCase());
    const kind = pcTags.some((tag) => lowerTags.includes(tag.toLowerCase())) ? 'character' : defaultKind;
    return `${gameSystem}-${kind}`;
}

/**
 * Create Foundry Actor data from a Kanka character entity.
 */
function createActorData(
    entity: KankaApiCharacter,
    entityTags: string[],
    campaignId: KankaApiId,
    defaultActorType: string,
    pcTags: string[],
    gameSystem: string,
): Record<string, unknown> {
    const actorType = determineActorType(entity, entityTags, defaultActorType, pcTags, gameSystem);
    const attributes = entity.attributes ?? [];

    const characteristics = buildCharacteristics(attributes);
    const statOverrides = buildSystemStats(attributes);

    const system: Record<string, unknown> = {
        ...statOverrides,
        characteristics,
    };

    const originPath: Record<string, string> = Object.fromEntries(
        Object.entries(ORIGIN_MAP)
            .map(([foundryKey, kankaName]): [string, string] => [foundryKey, getStringAttribute(attributes, kankaName)])
            .filter(([, value]) => value !== ''),
    );

    if (Object.keys(originPath).length > 0) {
        system['originPath'] = originPath;
    }

    const faction = getStringAttribute(attributes, ROOT_STRING_MAP['faction'] ?? '');

    if (actorType.endsWith('-character')) {
        const appearanceTraits = entity.traits?.filter((t) => t.section === 'appearance') ?? [];
        const personalityTraits = entity.traits?.filter((t) => t.section === 'personality') ?? [];

        system['bio'] = {
            gender: getStringAttribute(attributes, BIO_MAP['gender'] ?? '') || entity.sex || '',
            age: getStringAttribute(attributes, BIO_MAP['age'] ?? '') || (entity.age != null ? String(entity.age) : ''),
            build: getStringAttribute(attributes, BIO_MAP['build'] ?? '') || appearanceTraits.find((t) => t.name.toLowerCase() === 'build')?.entry || '',
            hair: getStringAttribute(attributes, BIO_MAP['hair'] ?? '') || appearanceTraits.find((t) => t.name.toLowerCase() === 'hair')?.entry || '',
            eyes: getStringAttribute(attributes, BIO_MAP['eyes'] ?? '') || appearanceTraits.find((t) => t.name.toLowerCase() === 'eyes')?.entry || '',
            complexion:
                getStringAttribute(attributes, BIO_MAP['complexion'] ?? '') || appearanceTraits.find((t) => t.name.toLowerCase() === 'complexion')?.entry || '',
            quirks: getStringAttribute(attributes, BIO_MAP['quirks'] ?? '') || personalityTraits.map((t) => `${t.name}: ${t.entry}`).join('; '),
            superstition: getStringAttribute(attributes, BIO_MAP['superstition'] ?? ''),
            mementos: getStringAttribute(attributes, BIO_MAP['mementos'] ?? ''),
            playerName: getStringAttribute(attributes, BIO_MAP['playerName'] ?? ''),
            notes: entity.entry ?? '',
        };
    } else {
        // NPC type — simpler schema
        if (entity.entry) {
            system['description'] = entity.entry;
        }
        const orgData = entity.organisations?.data;
        system['faction'] = faction || orgData?.[0]?.role || '';
    }

    if (faction && !system['faction']) {
        system['faction'] = faction;
    }

    return {
        name: entity.name,
        type: actorType,
        img: entity.has_custom_image ? entity.image_full : undefined,
        system,
        // displayName: 0 = NONE (hidden) for NPCs — players shouldn't get
        // free hover-ID on every uniformed extra. 30 = HOVER for PCs so the
        // party can tell each other apart at a glance.
        prototypeToken: {
            displayName: actorType.endsWith('-npc') ? 0 : 30,
        },
        flags: {
            'kanka-foundry': {
                kankaEntityId: entity.entity_id,
                kankaChildId: entity.id,
                campaign: campaignId,
                snapshot: entity,
                version: entity.updated_at,
            },
        },
        ownership: entity.is_private ? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } : { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
    };
}

/** Top-level `system.*` keys the Kanka sync owns outright (narrative/identity);
 *  everything else under `system` is mechanical and is conflict-checked on update. */
const NARRATIVE_SYSTEM_KEYS = new Set(['bio', 'faction', 'description']);

/** Type guard for plain-object tree nodes — replaces `as Record<...>` casts,
 *  which type-coverage --strict counts as uncovered. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Recursively flatten a plain object to `dot.path` -> leaf-value entries.
 *  Arrays and non-plain values are treated as leaves. */
function flattenLeaves(obj: Record<string, unknown>, prefix: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        const path = prefix === '' ? key : `${prefix}.${key}`;
        if (isPlainRecord(value)) {
            Object.assign(out, flattenLeaves(value, path));
        } else {
            out[path] = value;
        }
    }
    return out;
}

/** Read a `dot.path` value out of a loosely-typed object, or undefined. */
function readByPath(root: unknown, path: string): unknown {
    let cursor: unknown = root;
    for (const part of path.split('.')) {
        if (!isPlainRecord(cursor)) return undefined;
        cursor = cursor[part];
    }
    return cursor;
}

/**
 * Build the update payload for an existing actor. Narrative fields (bio,
 * faction, description) and identity (name/img/flags) are always applied.
 * Mechanical stats (characteristics, wounds, fate, xp, originPath, …) are
 * conflict-checked leaf-by-leaf against the actor's current values: a value is
 * applied only when the actor has none or it already matches; a genuine
 * conflict is REFUSED (the actor keeps its value) and collected for a warning.
 * This stops a sync from silently clobbering a built/advanced PC — or
 * re-stamping origin grants — when Kanka holds stale numbers.
 */
function buildConflictAwareUpdate(existing: Actor, actorData: Record<string, unknown>): { update: Record<string, unknown>; conflicts: string[] } {
    const systemRaw = actorData['system'];
    const system: Record<string, unknown> = isPlainRecord(systemRaw) ? systemRaw : {};
    // actor.system is loosely typed at the Foundry boundary — narrow via guard
    const currentRaw: unknown = Reflect.get(existing, 'system');
    const currentSystem: Record<string, unknown> = isPlainRecord(currentRaw) ? currentRaw : {};

    const update: Record<string, unknown> = {
        name: actorData['name'],
        img: actorData['img'],
        flags: actorData['flags'],
    };
    const conflicts: string[] = [];

    for (const [topKey, value] of Object.entries(system)) {
        if (NARRATIVE_SYSTEM_KEYS.has(topKey)) {
            update[`system.${topKey}`] = value;
            continue;
        }
        const leaves = isPlainRecord(value) ? flattenLeaves(value, topKey) : { [topKey]: value };
        for (const [path, incoming] of Object.entries(leaves)) {
            const current = readByPath(currentSystem, path);
            if (current !== undefined && current !== null && current !== incoming) {
                conflicts.push(`${path}: actor=${String(current)} != kanka=${String(incoming)}`);
                continue;
            }
            update[`system.${path}`] = incoming;
        }
    }
    return { update, conflicts };
}

/**
 * Find an existing Foundry Actor by its Kanka entity ID.
 */
function findActorByKankaEntityId(entityId: KankaApiEntityId): Actor | undefined {
    return game.actors?.find((a: Actor) => a.getFlag('kanka-foundry', 'kankaEntityId') === entityId) ?? undefined;
}

/**
 * Create or update a Foundry Actor from a Kanka character.
 */
export async function createOrUpdateActor(
    entity: KankaApiCharacter,
    entityTags: string[],
    campaignId: KankaApiId,
    defaultActorType: string,
    pcTags: string[],
    gameSystem: string,
): Promise<Actor> {
    const existing = findActorByKankaEntityId(entity.entity_id);
    const actorData = createActorData(entity, entityTags, campaignId, defaultActorType, pcTags, gameSystem);

    if (existing) {
        const { update, conflicts } = buildConflictAwareUpdate(existing, actorData);
        if (conflicts.length > 0) {
            // eslint-disable-next-line no-console -- surfacing a sync stat conflict to the GM console is the intended behavior
            console.warn(
                `[kanka-foundry] "${entity.name}": refused ${conflicts.length} conflicting stat write(s) from Kanka (actor value kept): ${conflicts.join('; ')}`,
            );
        }
        await existing.update(update);
        // Foundry copies actor.img into prototypeToken.texture.src by default
        // on create, so an unforced token sync will bail (the current value
        // looks "user-set"). Force it on every import so the canonical Kanka
        // token URL — which serves the circular-masked asset — is always the
        // token texture.
        await syncTokenImage(existing, campaignId, entity.entity_id, true);
        return existing;
    }

    // biome-ignore lint/complexity/noBannedTypes: Foundry's strict CreateData type doesn't accept dynamic actor data
    const created = (await (Actor.create as Function)(actorData)) as Actor;
    await syncTokenImage(created, campaignId, entity.entity_id, true);
    return created;
}
