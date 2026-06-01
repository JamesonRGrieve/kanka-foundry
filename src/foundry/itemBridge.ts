import type { KankaApiAttribute, KankaApiId, KankaApiItem } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
import { type PlainObject, asRecord, isRecord, readFunction, readProp, readRecord, readString } from '../util/reflection';

function assertType<T>(_value: unknown): asserts _value is T {}

/** Kanka attribute names that drive the Foundry compendium bridge. */
const FOUNDRY_UUID_ATTR = 'foundry_uuid';
const FOUNDRY_VARIANT_OVERRIDES_ATTR = 'foundry_variant_overrides';

/** Name of the world Item folder that bridged items are filed under. */
const KANKA_ITEM_FOLDER_NAME = 'Kanka';

// ---------------------------------------------------------------------------
// Pure helpers (separately testable — no Foundry globals)
// ---------------------------------------------------------------------------

/** Read a named attribute's string value from a Kanka item, or undefined. */
export function getItemAttribute(attributes: KankaApiAttribute[], name: string): string | undefined {
    const attr = attributes.find((a) => a.name === name);
    const value = attr?.value;
    return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Parse the `foundry_variant_overrides` JSON attribute into a flat map of
 * dot-path → value. Returns an empty object for missing/blank/invalid input —
 * never throws, since a malformed override must not break the import pipeline.
 */
export function parseVariantOverrides(raw: string | undefined): PlainObject {
    if (raw === undefined) return {};
    try {
        return asRecord(JSON.parse(raw)) ?? {};
    } catch (error) {
        logError(`Failed to parse ${FOUNDRY_VARIANT_OVERRIDES_ATTR}`, error);
        return {};
    }
}

/**
 * Set a single dot-path key (e.g. `clip.value`) to a value inside a target
 * object, creating intermediate plain objects as needed. Mutates `target`.
 */
export function setByPath(target: PlainObject, path: string, value: unknown): void {
    const parts = path.split('.').filter((p) => p !== '');
    const last = parts.pop();
    if (last === undefined) return;

    let cursor: PlainObject = target;
    for (const part of parts) {
        const next = cursor[part];
        if (next === null || typeof next !== 'object' || Array.isArray(next)) {
            const created: PlainObject = {};
            cursor[part] = created;
            cursor = created;
        } else {
            assertType<PlainObject>(next);
            cursor = next;
        }
    }

    cursor[last] = value;
}

/**
 * Apply a flat dot-path override map onto a target object. Each key is a
 * dot-path relative to the target root (e.g. `name`, `img`, or
 * `system.clip.dh2.value`). Returns the (mutated) target.
 */
export function applyVariantOverrides(target: PlainObject, overrides: PlainObject): PlainObject {
    for (const [path, value] of Object.entries(overrides)) {
        setByPath(target, path, value);
    }
    return target;
}

// ---------------------------------------------------------------------------
// Foundry glue (guarded global access, no `any`)
// ---------------------------------------------------------------------------

interface FoundryItemSource {
    name: string;
    type: string;
    img?: string;
    system: PlainObject;
    // eslint-disable-next-line no-restricted-syntax -- boundary: mirrors a Foundry Item source document, which carries arbitrary extra fields
    [key: string]: unknown;
}

interface FoundryItemLike {
    documentName: string;
    toObject(): PlainObject;
}

function isFoundryItem(value: unknown): value is FoundryItemLike {
    return readProp(value, 'documentName') === 'Item' && readFunction(value, 'toObject') !== undefined;
}

/** Resolve a UUID to a source object if (and only if) it points to an Item. */
async function resolveItemSource(uuid: string): Promise<FoundryItemSource | undefined> {
    const fromUuidFn = readFunction<(uuid: string) => Promise<object | null>>(globalThis, 'fromUuid');
    if (fromUuidFn === undefined) return undefined;

    const resolved = await fromUuidFn(uuid);
    if (!isFoundryItem(resolved)) return undefined;

    const source = resolved.toObject();
    if (!isRecord(source)) return undefined;
    const typeValue = readString(source, 'type');
    if (typeValue === undefined) return undefined;
    source['system'] = readRecord(source, 'system') ?? {};
    assertType<FoundryItemSource>(source);
    return source;
}

interface WorldItemLike {
    id: string;
    // eslint-disable-next-line no-restricted-syntax -- boundary: mirrors Foundry Document#getFlag, whose return is genuinely untyped
    getFlag(scope: string, key: string): unknown;
    // eslint-disable-next-line no-restricted-syntax -- boundary: mirrors Foundry Document#update, whose resolved value is the untyped document
    update(data: PlainObject): Promise<unknown>;
}

function* getGameItems(): Generator<object> {
    const raw = readProp(game, 'items');
    const valuesFn = readFunction<() => Iterable<object>>(raw, 'values');
    if (valuesFn === undefined || !isRecord(raw)) return;
    for (const item of valuesFn.call(raw)) {
        yield item;
    }
}

function findWorldItemByEntityId(entityId: KankaApiId): WorldItemLike | undefined {
    for (const item of getGameItems()) {
        if (readFunction(item, 'getFlag') === undefined) continue;
        assertType<WorldItemLike>(item);
        if (item.getFlag('kanka-foundry', 'entityId') === entityId) return item;
    }
    return undefined;
}

interface FolderLike {
    id: string;
}

function isFolder(value: unknown): value is FolderLike {
    return readString(value, 'id') !== undefined;
}

/** Find or create the world Item folder named "Kanka". */
async function ensureItemFolder(): Promise<FolderLike | undefined> {
    const foldersRaw = readProp(game, 'folders');
    const findFn = readFunction<(predicate: (f: object) => boolean) => unknown>(foldersRaw, 'find');
    if (findFn !== undefined && isRecord(foldersRaw)) {
        const isItemFolder = (f: object): boolean => readString(f, 'type') === 'Item' && readString(f, 'name') === KANKA_ITEM_FOLDER_NAME;
        const existing = findFn.call(foldersRaw, isItemFolder);
        if (isFolder(existing)) return existing;
    }

    const folderCreateFn = readFunction<(data: PlainObject) => Promise<object | null>>(Folder, 'create');
    if (folderCreateFn === undefined) return undefined;
    // Document.create is a static that relies on `this` being the document class
    // (it reads this.implementation); a detached call would lose that binding.
    const created = await folderCreateFn.call(Folder, { name: KANKA_ITEM_FOLDER_NAME, type: 'Item', folder: null });
    return isFolder(created) ? created : undefined;
}

/**
 * Build the create/update payload for a world Item from a cloned compendium
 * Item source, the Kanka item, and the resolved compendium UUID. Pure given
 * its inputs (the clone is mutated in place).
 *
 * The resulting world Item is a *variant* of the compendium base it was cloned
 * from: `system.variantOf` points back at that base (per the pack variant
 * schema), and the `foundry_variant_overrides` are applied as a document-rooted
 * dot-path patch. The patch may set a spoiler-free top-level `name`/`img` (the
 * variant's own player-facing identity) as well as `system.*` stat deltas; it is
 * applied last so an explicit `name` override wins over the entity's GM-facing
 * true name. With no `name` override the world Item keeps the entity name.
 */
export function buildWorldItemData(
    clone: FoundryItemSource,
    entity: KankaApiItem,
    compendiumUuid: string,
    overrides: PlainObject,
    campaignId: KankaApiId,
    folderId: string | undefined,
): PlainObject {
    const stats = readRecord(clone, '_stats') ?? {};
    stats['compendiumSource'] = compendiumUuid;

    // Mark the world Item as a variant of the compendium base it was cloned from.
    clone.system['variantOf'] = compendiumUuid;

    const data: PlainObject = {
        ...clone,
        name: entity.name,
        system: clone.system,
        folder: folderId,
        _stats: stats,
        flags: {
            'kanka-foundry': {
                entityId: entity.id,
                kankaEntityId: entity.entity_id,
                campaign: campaignId,
                snapshot: entity,
                version: entity.updated_at,
                compendiumSource: compendiumUuid,
            },
        },
    };

    applyVariantOverrides(data, overrides);

    return data;
}

/**
 * Bridge a Kanka item into a Foundry world Item by cloning a compendium Item
 * referenced through the `foundry_uuid` attribute.
 *
 * Only **variant-necessary** items are bridged: the item must carry
 * `foundry_variant_overrides` (a spoiler-free name, stat deltas, …) that make it
 * differ from its compendium base. A raw item with no overrides is simply an
 * instance of its homebrew/compendium base — the GM drops that compendium item
 * onto the actor directly, so the bridge mints no world Item for it.
 *
 * - No `foundry_uuid`, no overrides, or an unresolvable UUID → does nothing
 *   mechanical and lets the normal journal import proceed. Never throws.
 * - Bridgeable → deep-clones the compendium Item, applies the
 *   `foundry_variant_overrides`, stamps `system.variantOf` + Kanka flags +
 *   `_stats.compendiumSource`, and creates-or-updates a world Item (idempotent on
 *   `flags.kanka-foundry.entityId`).
 *
 * Returns the created/updated world Item's id, or undefined when nothing was done.
 */
export async function bridgeKankaItem(entity: KankaApiItem, campaignId: KankaApiId): Promise<string | undefined> {
    try {
        const attributes = entity.attributes;
        const uuid = getItemAttribute(attributes, FOUNDRY_UUID_ATTR);
        if (uuid === undefined) {
            // Not a bridgeable item — pure journal import, no log noise.
            return undefined;
        }

        const overrides = parseVariantOverrides(getItemAttribute(attributes, FOUNDRY_VARIANT_OVERRIDES_ATTR));
        if (Object.keys(overrides).length === 0) {
            // Raw compendium item (no variant overrides): the GM places the
            // compendium base on the actor directly — the bridge mints no world Item.
            logInfo(`Item bridge: "${entity.name}" has no variant overrides — raw compendium item, not creating a world Item`);
            return undefined;
        }

        const source = await resolveItemSource(uuid);
        if (!source) {
            logInfo(`Item bridge: UUID "${uuid}" for "${entity.name}" did not resolve to an Item — skipping mechanical bridge`);
            return undefined;
        }

        const folder = await ensureItemFolder();
        const data = buildWorldItemData(source, entity, uuid, overrides, campaignId, folder?.id);

        const existing = findWorldItemByEntityId(entity.id);
        if (existing) {
            await existing.update(data);
            logInfo(`Item bridge: updated world Item "${entity.name}" from ${uuid}`);
            return existing.id;
        }

        const itemCreateFn = readFunction<(data: PlainObject) => Promise<object | null>>(Item, 'create');
        if (itemCreateFn === undefined) return undefined;
        const created = await itemCreateFn.call(Item, data);
        if (created !== null) {
            logInfo(`Item bridge: created world Item "${entity.name}" from ${uuid}`);
            return readString(created, 'id');
        }
        return undefined;
    } catch (error) {
        logError(`Item bridge failed for "${entity.name}"`, error);
        return undefined;
    }
}
