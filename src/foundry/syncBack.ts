import api from '../api';
import type { KankaApiAttribute, KankaApiEntityId, KankaApiId } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
import { BIO_MAP, CHARACTERISTIC_REVERSE_MAP, ORIGIN_MAP, ROOT_STRING_MAP, STAT_REVERSE_MAP } from './actorAttributeMaps';
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
    conflicts: string[];
}

/**
 * Compare Foundry actor data against Kanka entity attributes.
 * Returns what needs to go in each direction and any conflicts.
 */
function reconcileFields(actor: Actor, kankaAttrs: KankaApiAttribute[]): ReconcileResult {
    const system = getActorSystem(actor);
    const toKanka = new Map<string, string>();
    const toFoundry: Record<string, unknown> = {};
    const conflicts: string[] = [];

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
                conflicts.push(`${kankaName}: Foundry=${foundryVal}, Kanka=${kankaVal}`);
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
                conflicts.push(`${kankaName}_advance: Foundry=${foundryAdv}, Kanka=${kankaAdv}`);
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
            conflicts.push(`${kankaName}: Foundry=${foundryVal}, Kanka=${kankaVal}`);
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
                conflicts.push(`${kankaName}: Foundry="${foundryVal}", Kanka="${kankaVal}"`);
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
                conflicts.push(`${kankaName}: Foundry="${foundryVal}", Kanka="${kankaVal}"`);
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
            // Kanka has data, Foundry doesn't — log for manual import
            // (Creating embedded items from JSON is complex; flag it for the GM)
            conflicts.push(`${key}: Kanka has data but Foundry is empty — re-import from Kanka to populate`);
        } else if (!foundryEmpty && kankaEmpty) {
            toKanka.set(key, foundryVal);
        } else if (!foundryEmpty && !kankaEmpty && foundryVal !== kankaVal) {
            conflicts.push(`${key}: Foundry and Kanka have different data`);
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
            conflicts.push(`${kankaName}: Foundry="${foundryVal}", Kanka="${kankaVal}"`);
        }
    }

    return { toKanka, toFoundry, conflicts };
}

/**
 * Check if a Foundry actor image path is a real, accessible image.
 * Verifies local paths actually exist by fetching them.
 */
async function _hasFoundryImage(actor: Actor): Promise<boolean> {
    const img = actor.img;
    if (!img || img === 'icons/svg/mystery-man.svg' || img === '') return false;

    // For local paths, verify the file exists
    if (!img.startsWith('http://') && !img.startsWith('https://')) {
        try {
            const resp = await fetch(img, { method: 'HEAD' });
            return resp.ok;
        } catch {
            return false;
        }
    }
    return true;
}

/**
 * Download an image via authenticated Kanka API and save it locally to Foundry.
 * Returns the local path (e.g., "assets/portraits/dalvor_rech.webp").
 */
async function _downloadKankaImage(imageUrl: string, actorName: string): Promise<string | null> {
    try {
        const response = await fetch(imageUrl, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) return null;
        const blob = await response.blob();

        const safeName = actorName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const ext = blob.type.includes('png') ? 'png' : blob.type.includes('jpeg') ? 'jpg' : 'webp';
        const fileName = `${safeName}.${ext}`;

        const file = new File([blob], fileName, { type: blob.type });
        const formData = new FormData();
        formData.append('source', 'data');
        formData.append('target', 'assets/portraits');
        formData.append('upload', file);

        const uploadResp = await fetch('/upload', { method: 'POST', body: formData });
        if (!uploadResp.ok) {
            logError(`Failed to save image locally: ${uploadResp.statusText}`);
            return null;
        }
        const resultRaw: unknown = await uploadResp.json();
        const path: unknown = resultRaw !== null && typeof resultRaw === 'object' ? Reflect.get(resultRaw, 'path') : undefined;
        return typeof path === 'string' ? path : `assets/portraits/${fileName}`;
    } catch (error) {
        logError(`Failed to download Kanka image for ${actorName}`, error);
        return null;
    }
}

/**
 * Check if a Foundry image path is a local path (not an external URL).
 */
function isLocalImage(img: string): boolean {
    return !img.startsWith('http://') && !img.startsWith('https://');
}

/**
 * Reconcile the image between Foundry and Kanka.
 * Same logic as field reconciliation: fill empty from the other, warn on conflict.
 * Images pulled from Kanka are saved locally to assets/portraits/ to avoid CORS.
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
    let portraitChanged = false;
    if (kankaHasImage && kankaImageUrl && foundryImg !== kankaImageUrl) {
        await actor.update({ img: kankaImageUrl });
        portraitChanged = true;
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

    // Sync token image (from Kanka entity asset named "token")
    const currentActor = getGameActors()?.get(actor.id ?? '') ?? actor;
    await syncTokenImage(currentActor, campaignId, kankaEntityId, portraitChanged);
}

/**
 * Reconcile a single actor with its Kanka entity.
 * Fills empty fields in both directions, warns on conflicts.
 */
async function reconcileActor(actor: Actor): Promise<void> {
    const kankaEntityIdRaw: unknown = getActorFlag(actor, 'kankaEntityId');
    let kankaEntityId: KankaApiEntityId | undefined;
    if (kankaEntityIdRaw !== undefined) {
        assertType<KankaApiEntityId>(kankaEntityIdRaw);
        kankaEntityId = kankaEntityIdRaw;
    }
    const kankaChildIdRaw: unknown = getActorFlag(actor, 'kankaChildId');
    let kankaChildId: KankaApiId | undefined;
    if (kankaChildIdRaw !== undefined) {
        assertType<KankaApiId>(kankaChildIdRaw);
        kankaChildId = kankaChildIdRaw;
    }
    const campaignIdRaw: unknown = getActorFlag(actor, 'campaign');
    let campaignId: KankaApiId | undefined;
    if (campaignIdRaw !== undefined) {
        assertType<KankaApiId>(campaignIdRaw);
        campaignId = campaignIdRaw;
    }
    if (!kankaEntityId || !kankaChildId || !campaignId) return;

    let kankaAttrs: KankaApiAttribute[];
    try {
        kankaAttrs = await api.getEntityAttributes(campaignId, kankaEntityId);
    } catch (error) {
        logError(`Failed to fetch Kanka attributes for ${actor.name}`, error);
        return;
    }

    const { toKanka, toFoundry, conflicts } = reconcileFields(actor, kankaAttrs);

    // Log conflicts
    for (const conflict of conflicts) {
        console.warn(`[kanka-foundry] CONFLICT on ${actor.name}: ${conflict}`);
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

function handleJournalUpdate(entry: JournalEntry, changes: Record<string, unknown>): void {
    if (!api.isReady) return;
    if (!game.user?.isGM) return;
    if (!(game.settings?.get('kanka-foundry', 'syncBackJournals') ?? false)) return;

    const kankaEntityId = getEntryFlag(entry, 'id');
    const campaignIdRaw3: unknown = getEntryFlag(entry, 'campaign');
    let campaignId: KankaApiId | undefined;
    if (campaignIdRaw3 !== undefined) {
        assertType<KankaApiId>(campaignIdRaw3);
        campaignId = campaignIdRaw3;
    }
    const snapshotRaw: unknown = getEntryFlag(entry, 'snapshot');
    let snapshot: Record<string, unknown> | undefined;
    if (snapshotRaw !== null && typeof snapshotRaw === 'object') {
        assertType<Record<string, unknown>>(snapshotRaw);
        snapshot = snapshotRaw;
    }
    if (!kankaEntityId || !campaignId || !snapshot) return;
    if (changes['name'] === undefined) return;

    const childIdRaw: unknown = snapshot['id'];
    assertType<KankaApiId>(childIdRaw);
    const childId: KankaApiId = childIdRaw;
    const key = `journal-${String(kankaEntityId)}`;
    const existingTimer = pendingTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(async () => {
        pendingTimers.delete(key);
        try {
            assertType<KankaApiId>(campaignId);
            await api.updateCharacter(campaignId, childId, { name: changes['name'] });
            logInfo('Synced journal name change to Kanka');
        } catch (error) {
            logError('Failed to sync journal changes to Kanka', error);
        }
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
    Hooks.on('updateItem', (item: Item) => handleItemChange(item));
    Hooks.on('deleteItem', (item: Item) => handleItemChange(item));

    Hooks.on('updateJournalEntry', (entry: JournalEntry, changes: Record<string, unknown>) => {
        handleJournalUpdate(entry, changes);
    });
}
