import type { KankaApiAttribute, KankaApiCharacter, KankaApiEntityId, KankaApiId } from '../types/kanka';
import { isNonEmptyString, readFunction } from '../util/reflection';
import { BIO_MAP, CHARACTERISTIC_MAP, ORIGIN_MAP, ROOT_STRING_MAP, STAT_MAP } from './actorAttributeMaps';
import { classifyFoundryPath } from './actorConflictMapping';
import { addConflicts } from './conflicts/conflictStore';
import { type StoredConflict, conflictId } from './conflicts/types';
import { syncTokenImage, type TokenFrameValue } from './tokenImage';

interface ImportFieldConflict {
    path: string;
    foundryValue: string;
    kankaValue: string;
}

function getAttributeValue(attributes: KankaApiAttribute[], name: string): number | null {
    const attr = attributes.find((a) => a.name === name);
    if (!attr?.value) return null;
    const num = Number(attr.value);
    return Number.isNaN(num) ? null : num;
}

function getStringAttribute(attributes: KankaApiAttribute[], name: string): string {
    return attributes.find((a) => a.name === name)?.value ?? '';
}

/** Parse the Kanka `token_frame` attribute (JSON `{cx,cy,zoom}`, pushed by the
 *  vault importer) into a validated frame, or null when absent/malformed. */
function parseTokenFrame(raw: string): TokenFrameValue | null {
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!isPlainRecord(parsed)) return null;
        const { cx, cy, zoom } = parsed;
        if (typeof cx !== 'number' || typeof cy !== 'number' || typeof zoom !== 'number') return null;
        return { cx, cy, zoom };
    } catch {
        return null;
    }
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
function buildConflictAwareUpdate(existing: Actor, actorData: Record<string, unknown>): { update: Record<string, unknown>; conflicts: ImportFieldConflict[] } {
    const systemRaw = actorData['system'];
    const system: Record<string, unknown> = isPlainRecord(systemRaw) ? systemRaw : {};
    // actor.system is loosely typed at the Foundry boundary — narrow via guard
    const currentRaw: unknown = Reflect.get(existing, 'system');
    const currentSystem: Record<string, unknown> = isPlainRecord(currentRaw) ? currentRaw : {};

    const update: Record<string, unknown> = {
        name: actorData['name'],
        flags: actorData['flags'],
    };
    // Only overwrite the portrait when Kanka actually supplies one. Kanka entities
    // very often have no custom image (has_custom_image=false -> img is undefined);
    // writing that through wipes the actor's existing portrait on every sync. Keep
    // the current image unless Kanka has a real one to replace it with.
    const incomingImg = actorData['img'];
    if (isNonEmptyString(incomingImg)) update['img'] = incomingImg;
    const conflicts: ImportFieldConflict[] = [];

    for (const [topKey, value] of Object.entries(system)) {
        if (NARRATIVE_SYSTEM_KEYS.has(topKey)) {
            update[`system.${topKey}`] = value;
            continue;
        }
        const leaves = isPlainRecord(value) ? flattenLeaves(value, topKey) : { [topKey]: value };
        for (const [path, incoming] of Object.entries(leaves)) {
            const current = readByPath(currentSystem, path);
            if (current !== undefined && current !== null && current !== incoming) {
                conflicts.push({ path, foundryValue: String(current), kankaValue: String(incoming) });
                continue;
            }
            update[`system.${path}`] = incoming;
        }
    }
    return { update, conflicts };
}

/** Turn refused import conflicts into resolvable registry records, dropping any
 *  field that has no Kanka counterpart to write back to. */
function toStoredImportConflicts(entityName: string, actorId: string, conflicts: ImportFieldConflict[]): StoredConflict[] {
    const stored: StoredConflict[] = [];
    for (const conflict of conflicts) {
        const classification = classifyFoundryPath(conflict.path);
        if (classification === undefined) continue;
        stored.push({
            id: conflictId('actor', actorId, classification.kankaAttr || conflict.path),
            kind: classification.kind,
            entityType: 'actor',
            entityId: actorId,
            entityName,
            label: conflict.path,
            kankaAttr: classification.kankaAttr,
            foundryPath: conflict.path,
            kankaValue: conflict.kankaValue,
            foundryValue: conflict.foundryValue,
        });
    }
    return stored;
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
/**
 * Approach B — canonical_sheet base actor. When the Kanka entity carries a
 * `base_actor` attribute (a compendium Actor UUID), clone that base's full stat
 * block, kit and prototype token onto the synced actor UNDER the Kanka-derived
 * data, so per-character advancements/overrides win. `fromUuid` loads the base
 * already flattened to the world's active game line, so a cross-line canonical
 * (a DW Purestrain carrying a `dh2` variant) arrives with the campaign line's
 * stats. Mutates `actorData` in place; returns the base's embedded item data to
 * attach, or null when there is no base.
 */
// eslint-disable-next-line no-restricted-syntax -- boundary: actorData is the Kanka→Foundry actor payload handed to Actor.create/Actor#update; Foundry's DataModel validates it on write
async function applyBaseActor(entity: KankaApiCharacter, actorData: Record<string, unknown>): Promise<object[] | null> {
    const baseUuid = getStringAttribute(entity.attributes, 'base_actor');
    if (!baseUuid) return null;
    // eslint-disable-next-line no-restricted-syntax -- boundary: fromUuid is a Foundry global returning an untyped Document; narrowed via readFunction + isPlainRecord
    const base: unknown = await fromUuid(baseUuid);
    const baseObj = readFunction<() => object>(base, 'toObject')?.();
    if (!isPlainRecord(baseObj)) return null;

    const baseItems = Array.isArray(baseObj['items']) ? (baseObj['items'] as object[]) : [];
    // Per-instance loadout: append the canonical_sheet.items weapons (a `base_items`
    // attribute of compendium UUIDs) as lean stubs, skipping any the base already carries.
    const baseSources = new Set(
        baseItems
            .map((i) => (isPlainRecord(i) && isPlainRecord(i['_stats']) ? i['_stats']['compendiumSource'] : undefined))
            .filter((s): s is string => typeof s === 'string'),
    );
    // Resolve the awaited loadout up front so the actorData writes below form one
    // synchronous region (no await between reading and mutating the shared payload).
    const instanceItems = (await resolveInstanceItems(entity)).filter((i) => !baseSources.has(i._stats.compendiumSource));

    const baseSystem = isPlainRecord(baseObj['system']) ? baseObj['system'] : {};
    const kankaSystem = isPlainRecord(actorData['system']) ? actorData['system'] : {};
    // base UNDER kanka: the base supplies the full stat block; Kanka data wins where set
    actorData['system'] = foundry.utils.mergeObject(baseSystem, kankaSystem, { inplace: false });

    // portrait: keep the Kanka one if present, else fall back to the base's image
    if (!isNonEmptyString(actorData['img']) && typeof baseObj['img'] === 'string') {
        actorData['img'] = baseObj['img'];
    }
    // prototype token: base ring/tokenFrame UNDER the Kanka displayName
    const baseToken = isPlainRecord(baseObj['prototypeToken']) ? baseObj['prototypeToken'] : {};
    const kankaToken = isPlainRecord(actorData['prototypeToken']) ? actorData['prototypeToken'] : {};
    const mergedToken = foundry.utils.mergeObject(baseToken, kankaToken, { inplace: false });
    // The base's prototypeToken carries the COMPENDIUM name (e.g. "Aberrant (Ranged)").
    // Tokens dragged out must use THIS character's name, so force the token name to the
    // Kanka-derived actor name rather than letting the base's name survive the merge.
    if (isPlainRecord(mergedToken)) mergedToken['name'] = actorData['name'];
    actorData['prototypeToken'] = mergedToken;

    const items = [...baseItems, ...instanceItems];
    actorData['items'] = items;
    return items;
}

/** Replace an actor's embedded items with the base actor's canonical kit. */
async function replaceEmbeddedKit(actor: Actor, baseItems: object[]): Promise<void> {
    const ids = actor.items.map((i) => i.id).filter((id): id is string => typeof id === 'string');
    if (ids.length > 0) await actor.deleteEmbeddedDocuments('Item', ids);
    // Item.CreateData is any-tainted in fvtt-types, so type-coverage counts the assertion; it is
    // a genuine framework boundary — the dynamically-cloned item source (type/name/system from
    // base.toObject().items + resolveInstanceItems stubs) is validated by Foundry on create.
    // type-coverage:ignore-next-line
    if (baseItems.length > 0) await actor.createEmbeddedDocuments('Item', baseItems as Item.CreateData[]);
}

/** A lean embedded-item stub: only name/type/img + the compendium join key. The
 * in-memory compendium join (compendium-hydrate.ts) fills the full body at load/render. */
interface LeanItemStub {
    name: string;
    type: string;
    img: string;
    _stats: { compendiumSource: string };
}

/**
 * Resolve a `base_items` attribute (newline/comma-joined compendium Item UUIDs, authored
 * as `canonical_sheet.items` in the vault) into lean stubs. This is the per-instance
 * loadout channel: the shared base actor supplies the biology/kit, and each character adds
 * the specific weapon(s) shown in its art without forking the base.
 */
async function resolveInstanceItems(entity: KankaApiCharacter): Promise<LeanItemStub[]> {
    const raw = getStringAttribute(entity.attributes, 'base_items');
    if (!raw) return [];
    const uuids = raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    if (uuids.length === 0) return [];
    const resolved = await Promise.all(
        uuids.map(async (uuid): Promise<LeanItemStub | null> => {
            // eslint-disable-next-line no-restricted-syntax -- boundary: fromUuid is a Foundry global returning an untyped Document; narrowed via readFunction + isPlainRecord
            const item: unknown = await fromUuid(uuid);
            const obj = readFunction<() => object>(item, 'toObject')?.();
            if (!isPlainRecord(obj)) return null;
            return {
                name: typeof obj['name'] === 'string' ? obj['name'] : '',
                type: typeof obj['type'] === 'string' ? obj['type'] : '',
                img: typeof obj['img'] === 'string' ? obj['img'] : '',
                _stats: { compendiumSource: uuid },
            };
        }),
    );
    return resolved.filter((s): s is LeanItemStub => s !== null);
}

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
    const tokenFrame = parseTokenFrame(getStringAttribute(entity.attributes, 'token_frame'));
    const baseItems = await applyBaseActor(entity, actorData);

    if (existing) {
        if (baseItems !== null) {
            // Base actor is the source of truth (base + advancements). Apply the merged
            // system directly rather than conflict-refusing it against the 30/30 default.
            const img = actorData['img'];
            // eslint-disable-next-line no-restricted-syntax -- boundary: Actor#update payload; values originate from createActorData's Record and are validated by Foundry's DataModel on write
            const baseUpdate: Record<string, unknown> = {
                name: actorData['name'],
                system: actorData['system'],
                flags: actorData['flags'],
                prototypeToken: actorData['prototypeToken'],
            };
            if (isNonEmptyString(img)) baseUpdate['img'] = img;
            await existing.update(baseUpdate);
            await replaceEmbeddedKit(existing, baseItems);
            await syncTokenImage(existing, campaignId, entity.entity_id, true, tokenFrame);
            return existing;
        }
        const { update, conflicts } = buildConflictAwareUpdate(existing, actorData);
        if (conflicts.length > 0) {
            const summary = conflicts.map((conflict) => `${conflict.path}: actor=${conflict.foundryValue} != kanka=${conflict.kankaValue}`).join('; ');
            // eslint-disable-next-line no-console -- surfacing a sync stat conflict to the GM console is the intended behavior
            console.warn(`[kanka-foundry] "${entity.name}": refused ${conflicts.length} conflicting stat write(s) from Kanka (actor value kept): ${summary}`);

            const actorId = existing.id ?? '';
            if (actorId) {
                await addConflicts(toStoredImportConflicts(entity.name, actorId, conflicts));
            }
        }
        await existing.update(update);
        // Foundry copies actor.img into prototypeToken.texture.src by default
        // on create, so an unforced token sync will bail (the current value
        // looks "user-set"). Force it on every import so the canonical Kanka
        // token URL — which serves the circular-masked asset — is always the
        // token texture.
        await syncTokenImage(existing, campaignId, entity.entity_id, true, tokenFrame);
        return existing;
    }

    // biome-ignore lint/complexity/noBannedTypes: Foundry's strict CreateData type doesn't accept dynamic actor data
    const created = (await (Actor.create as Function)(actorData)) as Actor;
    await syncTokenImage(created, campaignId, entity.entity_id, true, tokenFrame);
    return created;
}
