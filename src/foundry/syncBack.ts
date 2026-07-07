import api from '../api';
import type { KankaApiAttribute, KankaApiEntityId, KankaApiId, KankaApiModuleType } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
import { type PlainObject, asRecord, readProp, readRecord, readString } from '../util/reflection';
import { BIO_MAP, CHARACTERISTIC_REVERSE_MAP, ORIGIN_MAP, ROOT_STRING_MAP, STAT_REVERSE_MAP } from './actorAttributeMaps';
import { addConflicts } from './conflicts/conflictStore';
import { type ActorFieldConflict, type ConflictChoice, type ConflictKind, type StoredConflict, conflictId, isNumericKind } from './conflicts/types';
import { showWarning } from './notifications';
import { registerSceneSyncBackHooks } from './sceneSyncBack';
import { syncTokenImage } from './tokenImage';

function assertType<T>(_value: unknown): asserts _value is T {}

function getActorSystem(actor: Actor): Record<string, unknown> {
    const raw: unknown = Reflect.get(actor, 'system');
    assertType<Record<string, unknown>>(raw);
    return raw;
}

type ActorItemLike = { type: string; name: string; system: Record<string, unknown> };

function* getActorItems(actor: Actor): Generator<ActorItemLike> {
    const rawItems: unknown = Reflect.get(actor, 'items');
    if (rawItems === null || typeof rawItems !== 'object') return;
    // EmbeddedCollection has a `values()` method returning an Iterable — use it to avoid
    // any[] widening from Array.isArray. Reflect ensures no implicit-any property access.
    const valsFnRaw: unknown = Reflect.get(rawItems, 'values');
    if (typeof valsFnRaw !== 'function') return;
    // We need to call valsFn with rawItems as `this`. Use a typed wrapper:
    type ValuesGetter = { values(): Iterable<unknown> };
    assertType<ValuesGetter>(rawItems);
    for (const item of rawItems.values()) {
        if (item !== null && typeof item === 'object') {
            assertType<ActorItemLike>(item);
            yield item;
        }
    }
}

function getItemSystem(item: ActorItemLike): Record<string, unknown> {
    return item.system;
}

function getGameActors(): Actors | undefined {
    const raw: unknown = Reflect.get(game, 'actors');
    assertType<Actors | undefined>(raw);
    return raw;
}

function getActorFlag(actor: Actor, key: string): unknown {
    const raw: unknown = Reflect.get(actor, 'flags');
    if (raw === null || typeof raw !== 'object') return undefined;
    const kanka: unknown = Reflect.get(raw, 'kanka-foundry');
    if (kanka === null || typeof kanka !== 'object') return undefined;
    return Reflect.get(kanka, key);
}

function getEntryFlag(entry: JournalEntry, key: string): unknown {
    const raw: unknown = Reflect.get(entry, 'flags');
    if (raw === null || typeof raw !== 'object') return undefined;
    const kanka: unknown = Reflect.get(raw, 'kanka-foundry');
    if (kanka === null || typeof kanka !== 'object') return undefined;
    return Reflect.get(kanka, key);
}

function setNestedField(target: Record<string, unknown>, outerKey: string, innerKey: string, value: unknown): void {
    if (!target[outerKey]) target[outerKey] = {};
    const outer: unknown = target[outerKey];
    if (outer !== null && typeof outer === 'object') {
        Reflect.set(outer, innerKey, value);
    }
}

function getNestedField(target: Record<string, unknown>, outerKey: string, innerKey: string): unknown {
    const outer: unknown = target[outerKey];
    if (outer === null || typeof outer !== 'object') return undefined;
    return Reflect.get(outer, innerKey);
}

const DEBOUNCE_MS = 5000;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Pure helpers for write-back (separately testable — no Foundry globals)
// ---------------------------------------------------------------------------

/** A minimal view of a Foundry world Item's narrative-relevant fields. */
export interface ItemWriteBackInput {
    name?: string | undefined;
    type?: string | undefined;
    system?: PlainObject | undefined;
}

/**
 * Build the Kanka item update payload from a Foundry item. Pushes only
 * narrative fields — name, description, type, price, weight — and NEVER
 * mechanical stats (damage, penetration, etc.); Kanka is not the stat source.
 *
 * Field mapping (Foundry → Kanka, verified against KankaApiItem):
 *   item.name              → name
 *   item.system.description → entry
 *   item.type              → type   (the Foundry item subtype label)
 *   item.system.price      → price  (stringified — Kanka price is a string)
 *   item.system.weight     → weight (stringified — Kanka weight is a string)
 */
export function buildItemWriteBackPayload(item: ItemWriteBackInput): PlainObject {
    const payload: PlainObject = {};

    if (typeof item.name === 'string' && item.name !== '') payload['name'] = item.name;
    if (typeof item.type === 'string' && item.type !== '') payload['type'] = item.type;

    const system = item.system;
    if (system) {
        const description = system['description'];
        if (typeof description === 'string' && description !== '') payload['entry'] = description;

        const price = system['price'];
        if (typeof price === 'number' || (typeof price === 'string' && price !== '')) payload['price'] = String(price);

        const weight = system['weight'];
        if (typeof weight === 'number') {
            payload['weight'] = String(weight);
        } else if (typeof weight === 'object' && weight !== null) {
            // Some systems nest weight as { value, units }; take the value.
            const value = readProp(weight, 'value');
            if (typeof value === 'number' || (typeof value === 'string' && value !== '')) payload['weight'] = String(value);
        } else if (typeof weight === 'string' && weight !== '') {
            payload['weight'] = weight;
        }
    }

    return payload;
}

/**
 * Stringify a Kanka id (a number at runtime) into a debounce-map key fragment.
 * Returns undefined for anything that is not a number/string so callers can
 * fall back without stringifying the branded-id object union.
 */
// eslint-disable-next-line no-restricted-syntax -- boundary: id may arrive as an opaque flag value; both branches are typeof-guarded
function idToKey(value: unknown): string | undefined {
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    return undefined;
}

/** A journal update-method selection keyed by Kanka module type. */
export type JournalUpdateDispatch = 'character' | 'item' | 'quest' | null;

/**
 * Choose which Kanka update endpoint a journal-name change should be pushed to,
 * based on the entity's Kanka module type. Types without a dedicated update
 * method return null and are skipped (logged) rather than mislabelled.
 */
export function selectJournalUpdate(type: KankaApiModuleType | undefined): JournalUpdateDispatch {
    if (type === 'character' || type === 'item' || type === 'quest') return type;
    return null;
}

// ---------------------------------------------------------------------------
// Field mappings
// ---------------------------------------------------------------------------

/** Kanka attribute name -> Foundry system path */
const CHARACTERISTIC_MAP: Record<string, string> = Object.fromEntries(Object.entries(CHARACTERISTIC_REVERSE_MAP).map(([v, k]) => [k, v]));

/** Kanka attribute name -> Foundry system path */
const STAT_MAP: Record<string, string> = Object.fromEntries(Object.entries(STAT_REVERSE_MAP).map(([v, k]) => [k, v]));

/** JSON snapshot attribute names for complex data */
const SNAPSHOT_KEYS = ['character_skills', 'character_talents', 'character_equipment', 'character_weapons', 'character_armour', 'character_powers'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSystemValue(system: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let value: unknown = system;
    for (const part of parts) {
        if (value && typeof value === 'object') {
            value = Reflect.get(value, part);
        } else {
            return undefined;
        }
    }
    return value;
}

function isEmpty(value: unknown): boolean {
    return value === undefined || value === null || value === '' || value === 0;
}

function kankaAttrValue(attrs: KankaApiAttribute[], name: string): string | undefined {
    const attr = attrs.find((a) => a.name === name);
    return attr?.value ?? undefined;
}

// ---------------------------------------------------------------------------
// Snapshot builders (Foundry -> JSON for Kanka attributes)
// ---------------------------------------------------------------------------

function buildSkillsSnapshot(actor: Actor): string {
    const system = getActorSystem(actor);
    const skillsRaw: unknown = system['skills'];
    if (!skillsRaw || typeof skillsRaw !== 'object') return '{}';
    assertType<Record<string, Record<string, unknown>>>(skillsRaw);
    const skills = skillsRaw;

    const snapshot: Record<string, unknown> = {};
    for (const [key, skill] of Object.entries(skills)) {
        const advanceRaw: unknown = skill['advance'];
        const advance = typeof advanceRaw === 'number' ? advanceRaw : 0;
        const entriesRaw: unknown = skill['entries'];
        if (Array.isArray(entriesRaw)) assertType<Array<Record<string, unknown>>>(entriesRaw);
        const entries: Array<Record<string, unknown>> | undefined = Array.isArray(entriesRaw) ? entriesRaw : undefined;
        const trainedEntries = entries?.filter((e) => {
            const adv: unknown = e['advance'];
            return typeof adv === 'number' && adv > 0;
        });

        if (advance > 0 || (trainedEntries?.length ?? 0) > 0) {
            const entry: Record<string, unknown> = { advance, label: skill['label'] };
            if (trainedEntries?.length) {
                entry['entries'] = trainedEntries.map((e) => ({
                    label: e['label'],
                    advance: e['advance'],
                }));
            }
            snapshot[key] = entry;
        }
    }
    return JSON.stringify(snapshot);
}

function buildItemsSnapshot(actor: Actor, itemType: string): string {
    const allItems = Array.from(getActorItems(actor)).filter((i) => i.type === itemType);
    if (allItems.length === 0) return '[]';

    return JSON.stringify(
        allItems.map((item) => {
            const sys = getItemSystem(item);
            const entry: Record<string, unknown> = { name: item.name };

            if (itemType === 'talent') {
                entry['tier'] = sys['tier'];
                entry['specialization'] = sys['specialization'];
                entry['benefit'] = sys['benefit'];
                entry['cost'] = sys['cost'];
            } else if (itemType === 'psychicPower') {
                entry['discipline'] = sys['discipline'];
                entry['prCost'] = sys['prCost'];
                entry['effect'] = sys['effect'];
                entry['sustained'] = sys['sustained'];
            } else if (itemType === 'gear') {
                entry['category'] = sys['category'];
                entry['weight'] = sys['weight'];
                entry['equipped'] = sys['equipped'];
                entry['effect'] = sys['effect'];
            } else if (itemType === 'weapon') {
                entry['class'] = sys['class'];
                entry['type'] = sys['type'];
                entry['equipped'] = sys['equipped'];
                const dmgRaw: unknown = sys['damage'];
                if (dmgRaw !== null && typeof dmgRaw === 'object') {
                    assertType<Record<string, unknown>>(dmgRaw);
                    entry['damage'] = dmgRaw['damage'];
                    entry['damageType'] = dmgRaw['damageType'];
                    entry['penetration'] = dmgRaw['penetration'];
                }
            } else if (itemType === 'armour') {
                entry['equipped'] = sys['equipped'];
                entry['armourPoints'] = sys['armourPoints'];
            }

            return entry;
        }),
    );
}

// ---------------------------------------------------------------------------
// Bidirectional reconciliation
// ---------------------------------------------------------------------------

interface ReconcileResult {
    toKanka: Map<string, string>;
    toFoundry: Record<string, unknown>;
    conflicts: ActorFieldConflict[];
}

function fieldConflict(
    kind: ConflictKind,
    kankaAttr: string,
    foundryPath: string,
    label: string,
    foundryValue: unknown,
    kankaValue: unknown,
): ActorFieldConflict {
    return { kind, kankaAttr, foundryPath, label, foundryValue: String(foundryValue), kankaValue: String(kankaValue) };
}

/**
 * Compare Foundry actor data against Kanka entity attributes.
 * Returns what needs to go in each direction and any conflicts.
 */
function reconcileFields(actor: Actor, kankaAttrs: KankaApiAttribute[]): ReconcileResult {
    const system = getActorSystem(actor);
    const toKanka = new Map<string, string>();
    const toFoundry: Record<string, unknown> = {};
    const conflicts: ActorFieldConflict[] = [];

    // --- Characteristics ---
    const charsRaw: unknown = system['characteristics'];
    let chars: Record<string, Record<string, unknown>> | undefined;
    if (charsRaw !== null && typeof charsRaw === 'object') {
        assertType<Record<string, Record<string, unknown>>>(charsRaw);
        chars = charsRaw;
    }
    if (chars) {
        for (const [kankaName, foundryKey] of Object.entries(CHARACTERISTIC_MAP)) {
            const foundryVal = chars[foundryKey]?.['base'];
            const kankaVal = kankaAttrValue(kankaAttrs, kankaName);

            if (isEmpty(foundryVal) && !isEmpty(kankaVal)) {
                setNestedField(toFoundry, 'characteristics', foundryKey, { base: Number(kankaVal) });
            } else if (!isEmpty(foundryVal) && isEmpty(kankaVal)) {
                toKanka.set(kankaName, String(foundryVal));
            } else if (!isEmpty(foundryVal) && !isEmpty(kankaVal) && String(foundryVal) !== kankaVal) {
                conflicts.push(fieldConflict('characteristic', kankaName, `characteristics.${foundryKey}.base`, kankaName, foundryVal, kankaVal));
            }

            // Advances
            const foundryAdv = chars[foundryKey]?.['advance'];
            const kankaAdv = kankaAttrValue(kankaAttrs, `${kankaName}_advance`);
            if (isEmpty(foundryAdv) && !isEmpty(kankaAdv)) {
                const existing: unknown = getNestedField(toFoundry, 'characteristics', foundryKey);
                if (existing !== null && typeof existing === 'object') {
                    Reflect.set(existing, 'advance', Number(kankaAdv));
                } else {
                    setNestedField(toFoundry, 'characteristics', foundryKey, { advance: Number(kankaAdv) });
                }
            } else if (!isEmpty(foundryAdv) && isEmpty(kankaAdv)) {
                toKanka.set(`${kankaName}_advance`, String(foundryAdv));
            } else if (!isEmpty(foundryAdv) && !isEmpty(kankaAdv) && String(foundryAdv) !== kankaAdv) {
                conflicts.push(
                    fieldConflict(
                        'characteristic',
                        `${kankaName}_advance`,
                        `characteristics.${foundryKey}.advance`,
                        `${kankaName} advance`,
                        foundryAdv,
                        kankaAdv,
                    ),
                );
            }
        }
    }

    // --- Stats ---
    for (const [kankaName, foundryPath] of Object.entries(STAT_MAP)) {
        const foundryVal = getSystemValue(system, foundryPath);
        const kankaVal = kankaAttrValue(kankaAttrs, kankaName);

        if (isEmpty(foundryVal) && !isEmpty(kankaVal)) {
            const parts = foundryPath.split('.');
            const p0 = parts[0];
            const p1 = parts[1];
            if (parts.length === 2 && p0 !== undefined && p1 !== undefined) {
                setNestedField(toFoundry, p0, p1, Number(kankaVal));
            } else {
                toFoundry[foundryPath] = Number(kankaVal);
            }
        } else if (!isEmpty(foundryVal) && isEmpty(kankaVal)) {
            toKanka.set(kankaName, String(foundryVal));
        } else if (!isEmpty(foundryVal) && !isEmpty(kankaVal) && String(foundryVal) !== kankaVal) {
            conflicts.push(fieldConflict('stat', kankaName, foundryPath, kankaName, foundryVal, kankaVal));
        }
    }

    // --- Bio ---
    const bioRaw: unknown = system['bio'];
    let bio: Record<string, unknown> | undefined;
    if (bioRaw !== null && typeof bioRaw === 'object') {
        assertType<Record<string, unknown>>(bioRaw);
        bio = bioRaw;
    }
    if (bio) {
        for (const [foundryKey, kankaName] of Object.entries(BIO_MAP)) {
            const foundryVal = bio[foundryKey];
            const kankaVal = kankaAttrValue(kankaAttrs, kankaName);

            if (isEmpty(foundryVal) && !isEmpty(kankaVal)) {
                setNestedField(toFoundry, 'bio', foundryKey, kankaVal);
            } else if (!isEmpty(foundryVal) && isEmpty(kankaVal)) {
                toKanka.set(kankaName, String(foundryVal));
            } else if (!isEmpty(foundryVal) && !isEmpty(kankaVal) && String(foundryVal) !== kankaVal) {
                conflicts.push(fieldConflict('bio', kankaName, `bio.${foundryKey}`, foundryKey, foundryVal, kankaVal));
            }
        }
    }

    // --- Origin Path ---
    const originRaw: unknown = system['originPath'];
    let origin: Record<string, unknown> | undefined;
    if (originRaw !== null && typeof originRaw === 'object') {
        assertType<Record<string, unknown>>(originRaw);
        origin = originRaw;
    }
    if (origin) {
        for (const [foundryKey, kankaName] of Object.entries(ORIGIN_MAP)) {
            const foundryVal = origin[foundryKey];
            const kankaVal = kankaAttrValue(kankaAttrs, kankaName);

            if (isEmpty(foundryVal) && !isEmpty(kankaVal)) {
                setNestedField(toFoundry, 'originPath', foundryKey, kankaVal);
            } else if (!isEmpty(foundryVal) && isEmpty(kankaVal)) {
                toKanka.set(kankaName, String(foundryVal));
            } else if (!isEmpty(foundryVal) && !isEmpty(kankaVal) && String(foundryVal) !== kankaVal) {
                conflicts.push(fieldConflict('origin', kankaName, `originPath.${foundryKey}`, foundryKey, foundryVal, kankaVal));
            }
        }
    }

    // --- JSON snapshots (skills, talents, equipment) ---
    const snapshotBuilders: Record<string, () => string> = {
        character_skills: () => buildSkillsSnapshot(actor),
        character_talents: () => buildItemsSnapshot(actor, 'talent'),
        character_equipment: () => buildItemsSnapshot(actor, 'gear'),
        character_weapons: () => buildItemsSnapshot(actor, 'weapon'),
        character_armour: () => buildItemsSnapshot(actor, 'armour'),
        character_powers: () => buildItemsSnapshot(actor, 'psychicPower'),
    };

    for (const key of SNAPSHOT_KEYS) {
        const kankaVal = kankaAttrValue(kankaAttrs, key);
        const builder = snapshotBuilders[key];
        const foundryVal = builder ? builder() : '{}';
        const foundryEmpty = foundryVal === '{}' || foundryVal === '[]';
        const kankaEmpty = isEmpty(kankaVal) || kankaVal === '{}' || kankaVal === '[]';

        if (foundryEmpty && !kankaEmpty) {
            // Kanka has data, Foundry doesn't — flag for the GM. Creating embedded
            // items from JSON is complex, so a "keep Kanka" choice means a manual
            // re-import (handled in applyActorConflict); "keep Foundry" clears Kanka.
            conflicts.push(fieldConflict('snapshot', key, '', key, foundryVal, kankaVal));
        } else if (!foundryEmpty && kankaEmpty) {
            toKanka.set(key, foundryVal);
        } else if (!foundryEmpty && !kankaEmpty && foundryVal !== kankaVal) {
            conflicts.push(fieldConflict('snapshot', key, '', key, foundryVal, kankaVal));
        }
    }

    // --- Root string fields ---
    for (const [foundryKey, kankaName] of Object.entries(ROOT_STRING_MAP)) {
        const foundryVal = system[foundryKey];
        const kankaVal = kankaAttrValue(kankaAttrs, kankaName);

        if (isEmpty(foundryVal) && !isEmpty(kankaVal)) {
            toFoundry[foundryKey] = kankaVal;
        } else if (!isEmpty(foundryVal) && isEmpty(kankaVal)) {
            toKanka.set(kankaName, String(foundryVal));
        } else if (!isEmpty(foundryVal) && !isEmpty(kankaVal) && String(foundryVal) !== kankaVal) {
            conflicts.push(fieldConflict('rootString', kankaName, foundryKey, foundryKey, foundryVal, kankaVal));
        }
    }

    return { toKanka, toFoundry, conflicts };
}

/**
 * Check if a Foundry image path is a local path (not an external URL).
 */
function isLocalImage(img: string): boolean {
    return !img.startsWith('http://') && !img.startsWith('https://');
}

/**
 * Reconcile the image between Foundry and Kanka. Kanka is the single image host:
 * a Kanka portrait is HOTLINKED onto actor.img (its image_full URL) — never
 * downloaded into the Foundry data dir. If only Foundry holds a local image, it
 * is pushed up to Kanka so Kanka becomes the source. The canonical Foundry origin
 * (vtt.jamesonrgrieve.ca) is in Kanka's CORS allow-list, so the hotlinked URL
 * loads cleanly as a canvas texture (token bust + scene background alike).
 */
async function reconcileImage(actor: Actor, campaignId: KankaApiId, kankaEntityId: KankaApiEntityId, _kankaChildId: KankaApiId): Promise<void> {
    // Fetch entity data to get the current Kanka portrait
    let kankaEntity: { child?: { has_custom_image?: boolean; image_full?: string } };
    try {
        kankaEntity = await api.getEntity(campaignId, kankaEntityId);
    } catch (error) {
        logError(`Failed to fetch Kanka entity for image check on ${actor.name}`, error);
        return;
    }

    const kankaHasImage = kankaEntity.child?.has_custom_image === true;
    const kankaImageUrl = kankaEntity.child?.image_full;
    const foundryImg = actor.img;

    // Kanka is the single source of truth for portraits.
    // Use the Kanka URL directly — no local downloads.
    if (kankaHasImage && kankaImageUrl && foundryImg !== kankaImageUrl) {
        await actor.update({ img: kankaImageUrl });
        logInfo(`Portrait: Kanka → Foundry for ${actor.name}`);
    } else if (!kankaHasImage && foundryImg && isLocalImage(foundryImg)) {
        // Foundry has a local image but Kanka doesn't — push to Kanka
        try {
            const response = await fetch(foundryImg);
            if (response.ok) {
                const blob = await response.blob();
                await api.uploadEntityImage(campaignId, kankaEntityId, blob);
                logInfo(`Portrait: Foundry → Kanka for ${actor.name}`);
            }
        } catch (error) {
            logError(`Failed to upload image to Kanka for ${actor.name}`, error);
        }
    }

    // Sync token image (from Kanka entity asset named "token").
    // Force on every reconcile: Foundry copies actor.img into
    // prototypeToken.texture.src on actor create, so without force the
    // existence check inside syncTokenImage bails (treats the portrait URL
    // as user-customised). Kanka is the source of truth here.
    const currentActor = getGameActors()?.get(actor.id ?? '') ?? actor;
    await syncTokenImage(currentActor, campaignId, kankaEntityId, true);
    // Push the prototype token texture down to any already-placed scene
    // tokens for this actor, so a reconcile actually moves what the GM sees
    // — placed Tokens snapshot texture.src at placement and don't otherwise
    // pick up prototype changes.
    await propagateTokenTextureToScenes(currentActor);
}

async function propagateTokenTextureToScenes(actor: Actor): Promise<void> {
    const actorRaw: unknown = actor;
    const protoRaw: unknown = actorRaw !== null && typeof actorRaw === 'object' ? Reflect.get(actorRaw, 'prototypeToken') : undefined;
    if (protoRaw === null || typeof protoRaw !== 'object') return;
    const textureRaw: unknown = Reflect.get(protoRaw, 'texture');
    const src: unknown = textureRaw !== null && typeof textureRaw === 'object' ? Reflect.get(textureRaw, 'src') : undefined;
    if (typeof src !== 'string' || src === '') return;

    // Build the full token patch from the actor's current prototype so placed
    // tokens inherit the ring config (enabled, colors, effects, scale, subject
    // texture) the prototype was just updated with — not just the texture.
    const tokenPatch: Record<string, unknown> = { 'texture.src': src, 'sight.enabled': true };
    // Mirror the prototype's displayName onto placed tokens (kanka actors set
    // this to 0/NONE for NPCs in syncTokenImage; PCs keep whatever's there).
    const protoDisplayName: unknown = Reflect.get(protoRaw, 'displayName');
    if (typeof protoDisplayName === 'number') tokenPatch['displayName'] = protoDisplayName;
    const ringRaw: unknown = Reflect.get(protoRaw, 'ring');
    if (ringRaw !== null && typeof ringRaw === 'object') {
        const ringEnabled: unknown = Reflect.get(ringRaw, 'enabled');
        if (typeof ringEnabled === 'boolean') tokenPatch['ring.enabled'] = ringEnabled;
        const colors: unknown = Reflect.get(ringRaw, 'colors');
        if (colors !== null && typeof colors === 'object') {
            for (const key of ['ring', 'background'] as const) {
                const v: unknown = Reflect.get(colors, key);
                if (v !== undefined && v !== null) tokenPatch[`ring.colors.${key}`] = v;
            }
        }
        const effects: unknown = Reflect.get(ringRaw, 'effects');
        if (typeof effects === 'number') tokenPatch['ring.effects'] = effects;
        const subject: unknown = Reflect.get(ringRaw, 'subject');
        if (subject !== null && typeof subject === 'object') {
            const subjTex: unknown = Reflect.get(subject, 'texture');
            if (typeof subjTex === 'string' && subjTex !== '') {
                tokenPatch['ring.subject.texture'] = subjTex;
            }
            const subjScale: unknown = Reflect.get(subject, 'scale');
            if (typeof subjScale === 'number') {
                tokenPatch['ring.subject.scale'] = subjScale;
            }
        }
    }

    const scenesRaw: unknown = Reflect.get(game, 'scenes');
    if (scenesRaw === null || scenesRaw === undefined) return;
    assertType<Scenes>(scenesRaw);
    for (const scene of scenesRaw) {
        for (const token of scene.tokens) {
            if (token === null || typeof token !== 'object') continue;
            const tokActorIdRaw: unknown = Reflect.get(token, 'actorId');
            if (tokActorIdRaw !== actor.id) continue;
            const updateRaw: unknown = Reflect.get(token, 'update');
            if (typeof updateRaw !== 'function') continue;
            assertType<(data: Record<string, unknown>) => Promise<void>>(updateRaw);
            try {
                await updateRaw.call(token, tokenPatch);
            } catch (error) {
                logError(`Failed to update placed token for ${actor.name}`, error);
            }
        }
    }
}

/**
 * Reconcile a single actor with its Kanka entity.
 * Fills empty fields in both directions, warns on conflicts.
 */
interface ActorKankaIds {
    campaignId: KankaApiId;
    kankaEntityId: KankaApiEntityId;
    kankaChildId: KankaApiId;
}

/** Read the Kanka linkage flags off an actor, or undefined when it isn't linked. */
function getActorKankaIds(actor: Actor): ActorKankaIds | undefined {
    const kankaEntityIdRaw: unknown = getActorFlag(actor, 'kankaEntityId');
    const kankaChildIdRaw: unknown = getActorFlag(actor, 'kankaChildId');
    const campaignIdRaw: unknown = getActorFlag(actor, 'campaign');
    if (kankaEntityIdRaw === undefined || kankaChildIdRaw === undefined || campaignIdRaw === undefined) return undefined;
    assertType<KankaApiEntityId>(kankaEntityIdRaw);
    assertType<KankaApiId>(kankaChildIdRaw);
    assertType<KankaApiId>(campaignIdRaw);
    return { campaignId: campaignIdRaw, kankaEntityId: kankaEntityIdRaw, kankaChildId: kankaChildIdRaw };
}

/** Expand a dot path (`characteristics.weaponSkill.base`) into a nested object
 *  suitable for a deep-merging `actor.update({ system: … })` call. */
function expandPath(path: string, value: unknown): Record<string, unknown> {
    const parts = path.split('.');
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (key === undefined) continue;
        const next: Record<string, unknown> = {};
        cursor[key] = next;
        cursor = next;
    }
    const last = parts[parts.length - 1];
    if (last !== undefined) cursor[last] = value;
    return root;
}

/** Turn the structured field conflicts for one actor into persistable records. */
function toStoredActorConflicts(actor: Actor, actorId: string, conflicts: ActorFieldConflict[]): StoredConflict[] {
    return conflicts.map((conflict) => ({
        id: conflictId('actor', actorId, conflict.kankaAttr || conflict.foundryPath),
        entityType: 'actor',
        entityId: actorId,
        entityName: actor.name ?? actorId,
        ...conflict,
    }));
}

async function reconcileActor(actor: Actor): Promise<void> {
    const ids = getActorKankaIds(actor);
    if (!ids) return;
    const { campaignId, kankaEntityId, kankaChildId } = ids;

    let kankaAttrs: KankaApiAttribute[];
    try {
        kankaAttrs = await api.getEntityAttributes(campaignId, kankaEntityId);
    } catch (error) {
        logError(`Failed to fetch Kanka attributes for ${actor.name}`, error);
        return;
    }

    const { toKanka, toFoundry, conflicts } = reconcileFields(actor, kankaAttrs);

    // Record conflicts for GM resolution on next join, and log them for history.
    const actorId = actor.id ?? '';
    if (conflicts.length > 0 && actorId) {
        await addConflicts(toStoredActorConflicts(actor, actorId, conflicts));
    }
    for (const conflict of conflicts) {
        console.warn(`[kanka-foundry] CONFLICT on ${actor.name}: ${conflict.label}: Foundry=${conflict.foundryValue}, Kanka=${conflict.kankaValue}`);
    }

    // Push to Kanka
    if (toKanka.size > 0) {
        for (const [name, value] of toKanka) {
            const existing = kankaAttrs.find((a) => a.name === name);
            try {
                if (existing) {
                    await api.updateEntityAttribute(campaignId, kankaEntityId, existing.id, { value });
                } else {
                    await api.createEntityAttribute(campaignId, kankaEntityId, {
                        name,
                        value,
                    });
                }
            } catch (error) {
                logError(`Failed to push ${name} to Kanka for ${actor.name}`, error);
            }
        }
        logInfo(`Reconciled ${toKanka.size} field(s) Foundry → Kanka for ${actor.name}`);
    }

    // Pull to Foundry
    if (Object.keys(toFoundry).length > 0) {
        try {
            await actor.update({ system: toFoundry });
            logInfo(`Reconciled ${Object.keys(toFoundry).length} field(s) Kanka → Foundry for ${actor.name}`);
        } catch (error) {
            logError(`Failed to update Foundry actor ${actor.name}`, error);
        }
    }

    // Reconcile image
    try {
        await reconcileImage(actor, campaignId, kankaEntityId, kankaChildId);
    } catch (error) {
        logError(`Image reconciliation failed for ${actor.name}`, error);
    }

    if (toKanka.size === 0 && Object.keys(toFoundry).length === 0 && conflicts.length === 0) {
        logInfo(`${actor.name}: in sync`);
    }
}

/**
 * Reconcile all Kanka-linked actors on module ready.
 */
export async function reconcileAllActors(): Promise<void> {
    if (!api.isReady) return;
    if (!game.user?.isGM) return;
    if (!(game.settings?.get('kanka-foundry', 'syncBackActors') ?? false)) return;

    const actors = getGameActors()?.filter((a: Actor) => getActorFlag(a, 'kankaEntityId') !== undefined) ?? [];

    if (actors.length === 0) return;

    logInfo(`Reconciling ${actors.length} Kanka-linked actor(s)...`);
    for (const actor of actors) {
        await reconcileActor(actor);
    }
    logInfo('Reconciliation complete.');
}

/**
 * Recompute the conflict ids currently present for an actor. The resolver uses
 * this to discard stored conflicts that have since been fixed out-of-band, so
 * the popup never shows a row that is no longer divergent.
 */
export async function recomputeActorConflictIds(actorId: string): Promise<Set<string>> {
    const actor = getGameActors()?.get(actorId);
    if (!actor) return new Set();
    const ids = getActorKankaIds(actor);
    if (!ids) return new Set();

    let kankaAttrs: KankaApiAttribute[];
    try {
        kankaAttrs = await api.getEntityAttributes(ids.campaignId, ids.kankaEntityId);
    } catch (error) {
        logError(`Failed to revalidate conflicts for ${actor.name}`, error);
        return new Set();
    }

    const { conflicts } = reconcileFields(actor, kankaAttrs);
    return new Set(conflicts.map((conflict) => conflictId('actor', actorId, conflict.kankaAttr || conflict.foundryPath)));
}

/**
 * Apply a resolved actor conflict to the chosen side. `foundry` pushes the
 * Foundry value to Kanka; `kanka` writes the Kanka value into Foundry. Snapshot
 * collections cannot be rebuilt from JSON, so a `kanka` choice there asks the GM
 * to re-import instead. Returns true when the chosen side was applied (or, for a
 * snapshot re-import, acknowledged).
 */
export async function applyActorConflict(conflict: StoredConflict, choice: ConflictChoice): Promise<boolean> {
    const actor = getGameActors()?.get(conflict.entityId);
    if (!actor) return false;

    if (choice === 'foundry') {
        if (!conflict.kankaAttr) return false;
        const ids = getActorKankaIds(actor);
        if (!ids) return false;

        let kankaAttrs: KankaApiAttribute[];
        try {
            kankaAttrs = await api.getEntityAttributes(ids.campaignId, ids.kankaEntityId);
        } catch (error) {
            logError(`Failed to fetch Kanka attributes for ${actor.name}`, error);
            return false;
        }

        const existing = kankaAttrs.find((attr) => attr.name === conflict.kankaAttr);
        try {
            if (existing) {
                await api.updateEntityAttribute(ids.campaignId, ids.kankaEntityId, existing.id, { value: conflict.foundryValue });
            } else {
                await api.createEntityAttribute(ids.campaignId, ids.kankaEntityId, { name: conflict.kankaAttr, value: conflict.foundryValue });
            }
        } catch (error) {
            logError(`Failed to push ${conflict.kankaAttr} to Kanka for ${actor.name}`, error);
            return false;
        }
        return true;
    }

    // choice === 'kanka' → write the Kanka value into Foundry
    if (conflict.kind === 'snapshot') {
        showWarning('conflicts.reimportRequired');
        return true;
    }
    if (!conflict.foundryPath) return false;

    const value: unknown = isNumericKind(conflict.kind) ? Number(conflict.kankaValue) : conflict.kankaValue;
    try {
        await actor.update({ system: expandPath(conflict.foundryPath, value) });
    } catch (error) {
        logError(`Failed to update Foundry actor ${actor.name}`, error);
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Change-driven sync (debounced)
// ---------------------------------------------------------------------------

function scheduleActorSync(actor: Actor, _syncItems: boolean): void {
    if (!api.isReady) return;
    if (!game.user?.isGM) return;
    if (!(game.settings?.get('kanka-foundry', 'syncBackActors') ?? false)) return;

    const kankaEntityIdRaw2: unknown = getActorFlag(actor, 'kankaEntityId');
    let kankaEntityId: KankaApiEntityId | undefined;
    if (kankaEntityIdRaw2 !== undefined) {
        assertType<KankaApiEntityId>(kankaEntityIdRaw2);
        kankaEntityId = kankaEntityIdRaw2;
    }
    const campaignIdRaw2: unknown = getActorFlag(actor, 'campaign');
    let campaignId: KankaApiId | undefined;
    if (campaignIdRaw2 !== undefined) {
        assertType<KankaApiId>(campaignIdRaw2);
        campaignId = campaignIdRaw2;
    }
    if (!kankaEntityId || !campaignId) return;

    const key = String(kankaEntityId);
    const existingTimer = pendingTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(async () => {
        pendingTimers.delete(key);
        const currentActor = actor.id ? (getGameActors()?.get(actor.id) ?? actor) : actor;
        await reconcileActor(currentActor);
    }, DEBOUNCE_MS);

    pendingTimers.set(key, timer);
}

function handleActorUpdate(actor: Actor, changes: Record<string, unknown>): void {
    if (!changes['system'] && !changes['name'] && !changes['img']) return;

    // If portrait changed, re-sync token
    if (changes['img']) {
        const eidRaw: unknown = getActorFlag(actor, 'kankaEntityId');
        let eid: KankaApiEntityId | undefined;
        if (eidRaw !== undefined) {
            assertType<KankaApiEntityId>(eidRaw);
            eid = eidRaw;
        }
        const cidRaw: unknown = getActorFlag(actor, 'campaign');
        let cid: KankaApiId | undefined;
        if (cidRaw !== undefined) {
            assertType<KankaApiId>(cidRaw);
            cid = cidRaw;
        }
        if (eid && cid) {
            syncTokenImage(actor, cid, eid, true);
        }
    }

    scheduleActorSync(actor, false);
}

function handleItemChange(item: Item): void {
    const actor = item.parent;
    if (!(actor instanceof Actor)) return;

    const relevantTypes = ['talent', 'psychicPower', 'gear', 'weapon', 'armour'];
    if (!relevantTypes.includes(item.type)) return;

    scheduleActorSync(actor, true);
}

/** Push a journal payload to the correct Kanka endpoint for its module type. */
async function dispatchJournalUpdate(dispatch: JournalUpdateDispatch, campaignId: KankaApiId, childId: KankaApiId, payload: PlainObject): Promise<void> {
    switch (dispatch) {
        case 'character':
            await api.updateCharacter(campaignId, childId, payload);
            return;
        case 'item':
            await api.updateItem(campaignId, childId, payload);
            return;
        case 'quest':
            await api.updateQuest(campaignId, childId, payload);
            return;
        case null:
            logInfo('Journal sync-back: no update endpoint for this entity type — skipping');
    }
}

function handleJournalUpdate(entry: JournalEntry, _changes: Record<string, unknown>): void {
    if (!api.isReady) return;
    if (game.user?.isGM !== true) return;
    if (game.settings?.get('kanka-foundry', 'syncBackJournals') !== true) return;

    const kankaEntityId = getEntryFlag(entry, 'id');
    const campaignIdRaw3 = getEntryFlag(entry, 'campaign');
    let campaignId: KankaApiId | undefined;
    if (campaignIdRaw3 !== undefined) {
        assertType<KankaApiId>(campaignIdRaw3);
        campaignId = campaignIdRaw3;
    }
    const snapshot = asRecord(getEntryFlag(entry, 'snapshot'));
    if (kankaEntityId === undefined || kankaEntityId === null || campaignId === undefined || snapshot === undefined) return;

    const typeRaw = getEntryFlag(entry, 'type');
    let type: KankaApiModuleType | undefined;
    if (typeof typeRaw === 'string') {
        assertType<KankaApiModuleType>(typeRaw);
        type = typeRaw;
    }
    const dispatch = selectJournalUpdate(type);

    // Build the payload. The entity NAME is deliberately NOT written back to
    // Kanka: Kanka (fed from the vault) is the authoritative source for names and
    // entities are reconciled by Kanka ID, never by name. Pushing a Foundry
    // journal's title back would let a stale Foundry name overwrite the correct
    // Kanka name — the "entity.name drifts from character.name" corruption. Only
    // non-identity state (quest completion) is allowed to flow Foundry -> Kanka.
    const payload: PlainObject = {};

    if (type === 'quest') {
        const completedRaw = getEntryFlag(entry, 'completed');
        if (typeof completedRaw === 'boolean') {
            const snapshotCompleted = snapshot['is_completed'];
            if (completedRaw !== snapshotCompleted) payload['is_completed'] = completedRaw;
        }
    }

    if (Object.keys(payload).length === 0) return;

    const childIdRaw = snapshot['id'];
    assertType<KankaApiId>(childIdRaw);
    const childId: KankaApiId = childIdRaw;
    const key = `journal-${idToKey(kankaEntityId) ?? 'unknown'}`;
    const existingTimer = pendingTimers.get(key);
    if (existingTimer !== undefined) clearTimeout(existingTimer);

    const campaignIdFinal: KankaApiId = campaignId;
    const timer = setTimeout(() => {
        pendingTimers.delete(key);
        void (async (): Promise<void> => {
            try {
                await dispatchJournalUpdate(dispatch, campaignIdFinal, childId, payload);
                if (dispatch !== null) logInfo('Synced journal change to Kanka');
            } catch (error) {
                logError('Failed to sync journal changes to Kanka', error);
            }
        })();
    }, DEBOUNCE_MS);

    pendingTimers.set(key, timer);
}

// ---------------------------------------------------------------------------
// World Item narrative write-back
// ---------------------------------------------------------------------------

function getItemKankaFlags(item: Item): PlainObject {
    return readRecord(readRecord(item, 'flags'), 'kanka-foundry') ?? {};
}

function getItemViewForWriteBack(item: Item): ItemWriteBackInput {
    return {
        name: readString(item, 'name'),
        type: readString(item, 'type'),
        system: readRecord(item, 'system'),
    };
}

/** Sync-back for WORLD items carrying a Kanka entityId flag (bridged items). */
function handleWorldItemUpdate(item: Item): void {
    if (!api.isReady) return;
    if (game.user?.isGM !== true) return;
    if (game.settings?.get('kanka-foundry', 'syncBackJournals') !== true) return;
    // Only world items: embedded items live on an actor and are handled by the
    // actor sync path. Bridged items are world-level documents.
    if (item.parent instanceof Actor) return;

    const flags = getItemKankaFlags(item);
    const entityIdRaw = flags['entityId'];
    let childId: KankaApiId | undefined;
    if (entityIdRaw !== undefined && entityIdRaw !== null) {
        assertType<KankaApiId>(entityIdRaw);
        childId = entityIdRaw;
    }
    const campaignRaw = flags['campaign'];
    let campaignId: KankaApiId | undefined;
    if (campaignRaw !== undefined) {
        assertType<KankaApiId>(campaignRaw);
        campaignId = campaignRaw;
    }
    const kankaEntityIdRaw = flags['kankaEntityId'];
    if (childId === undefined || campaignId === undefined) return;

    const payload = buildItemWriteBackPayload(getItemViewForWriteBack(item));
    if (Object.keys(payload).length === 0) return;

    const key = `item-${idToKey(kankaEntityIdRaw) ?? idToKey(childId) ?? 'unknown'}`;
    const existingTimer = pendingTimers.get(key);
    if (existingTimer !== undefined) clearTimeout(existingTimer);

    const itemName = readString(item, 'name') ?? '';
    const childIdFinal: KankaApiId = childId;
    const campaignIdFinal: KankaApiId = campaignId;
    const timer = setTimeout(() => {
        pendingTimers.delete(key);
        void (async (): Promise<void> => {
            try {
                await api.updateItem(campaignIdFinal, childIdFinal, payload);
                logInfo(`Synced item "${itemName}" narrative to Kanka`);
            } catch (error) {
                logError(`Failed to sync item "${itemName}" to Kanka`, error);
            }
        })();
    }, DEBOUNCE_MS);

    pendingTimers.set(key, timer);
}

// ---------------------------------------------------------------------------
// Hook registration
// ---------------------------------------------------------------------------

export function registerSyncBackHooks(): void {
    Hooks.on('updateActor', (actor: Actor, changes: Record<string, unknown>) => {
        handleActorUpdate(actor, changes);
    });

    Hooks.on('createItem', (item: Item) => handleItemChange(item));
    Hooks.on('updateItem', (item: Item) => {
        handleItemChange(item);
        handleWorldItemUpdate(item);
    });
    Hooks.on('deleteItem', (item: Item) => handleItemChange(item));

    Hooks.on('updateJournalEntry', (entry: JournalEntry, changes: Record<string, unknown>) => {
        handleJournalUpdate(entry, changes);
    });

    // Bidirectional map sync: Foundry Scene/Note edits → Kanka map markers.
    registerSceneSyncBackHooks();
}
