import api from '../api';
import type { KankaApiAttribute, KankaApiEntityId, KankaApiId } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
import {
    CHARACTERISTIC_REVERSE_MAP,
    STAT_REVERSE_MAP,
} from './actorFactory';
import { syncTokenImage } from './tokenImage';

const DEBOUNCE_MS = 5000;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Field mappings
// ---------------------------------------------------------------------------

/** Kanka attribute name -> Foundry system path */
const CHARACTERISTIC_MAP: Record<string, string> = Object.fromEntries(
    Object.entries(CHARACTERISTIC_REVERSE_MAP).map(([v, k]) => [k, v]),
);

/** Kanka attribute name -> Foundry system path */
const STAT_MAP: Record<string, string> = Object.fromEntries(
    Object.entries(STAT_REVERSE_MAP).map(([v, k]) => [k, v]),
);

/** Foundry system.bio.* key -> Kanka attribute name */
const BIO_MAP: Record<string, string> = {
    gender: 'bio_gender',
    age: 'bio_age',
    build: 'bio_build',
    complexion: 'bio_complexion',
    hair: 'bio_hair',
    eyes: 'bio_eyes',
    quirks: 'bio_quirks',
    superstition: 'bio_superstition',
    mementos: 'bio_mementos',
    playerName: 'bio_playerName',
};

/** Foundry system.originPath.* key -> Kanka attribute name */
const ORIGIN_MAP: Record<string, string> = {
    background: 'origin_background',
    role: 'origin_role',
    homeWorld: 'origin_homeWorld',
    divination: 'origin_divination',
    elite: 'origin_elite',
    career: 'origin_career',
    regiment: 'origin_regiment',
    speciality: 'origin_speciality',
};

/** JSON snapshot attribute names for complex data */
const SNAPSHOT_KEYS = [
    'character_skills',
    'character_talents',
    'character_equipment',
    'character_weapons',
    'character_armour',
    'character_powers',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSystemValue(system: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let value: unknown = system;
    for (const part of parts) {
        if (value && typeof value === 'object') {
            value = (value as Record<string, unknown>)[part];
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
    const system = (actor as unknown as { system: Record<string, unknown> }).system;
    const skills = system.skills as Record<string, Record<string, unknown>> | undefined;
    if (!skills) return '{}';

    const snapshot: Record<string, unknown> = {};
    for (const [key, skill] of Object.entries(skills)) {
        const advance = skill.advance as number;
        const entries = skill.entries as Array<Record<string, unknown>> | undefined;
        const trainedEntries = entries?.filter((e) => (e.advance as number) > 0);

        if (advance > 0 || (trainedEntries?.length ?? 0) > 0) {
            const entry: Record<string, unknown> = { advance, label: skill.label };
            if (trainedEntries?.length) {
                entry.entries = trainedEntries.map((e) => ({
                    label: e.label,
                    advance: e.advance,
                }));
            }
            snapshot[key] = entry;
        }
    }
    return JSON.stringify(snapshot);
}

function buildItemsSnapshot(actor: Actor, itemType: string): string {
    const items = (actor as unknown as { items: Collection<Item> }).items
        .filter((i: Item) => i.type === itemType);
    if (items.length === 0) return '[]';

    return JSON.stringify(items.map((item: Item) => {
        const sys = (item as unknown as { system: Record<string, unknown> }).system;
        const entry: Record<string, unknown> = { name: item.name };

        if (itemType === 'talent') {
            entry.tier = sys.tier;
            entry.specialization = sys.specialization;
            entry.benefit = sys.benefit;
            entry.cost = sys.cost;
        } else if (itemType === 'psychicPower') {
            entry.discipline = sys.discipline;
            entry.prCost = sys.prCost;
            entry.effect = sys.effect;
            entry.sustained = sys.sustained;
        } else if (itemType === 'gear') {
            entry.category = sys.category;
            entry.weight = sys.weight;
            entry.equipped = sys.equipped;
            entry.effect = sys.effect;
        } else if (itemType === 'weapon') {
            entry.class = sys.class;
            entry.type = sys.type;
            entry.equipped = sys.equipped;
            const dmg = sys.damage as Record<string, unknown> | undefined;
            if (dmg) {
                entry.damage = dmg.damage;
                entry.damageType = dmg.damageType;
                entry.penetration = dmg.penetration;
            }
        } else if (itemType === 'armour') {
            entry.equipped = sys.equipped;
            entry.armourPoints = sys.armourPoints;
        }

        return entry;
    }));
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
function reconcileFields(
    actor: Actor,
    kankaAttrs: KankaApiAttribute[],
): ReconcileResult {
    const system = (actor as unknown as { system: Record<string, unknown> }).system;
    const toKanka = new Map<string, string>();
    const toFoundry: Record<string, unknown> = {};
    const conflicts: string[] = [];

    // --- Characteristics ---
    const chars = system.characteristics as Record<string, Record<string, unknown>> | undefined;
    if (chars) {
        for (const [kankaName, foundryKey] of Object.entries(CHARACTERISTIC_MAP)) {
            const foundryVal = chars[foundryKey]?.base;
            const kankaVal = kankaAttrValue(kankaAttrs, kankaName);

            if (isEmpty(foundryVal) && !isEmpty(kankaVal)) {
                if (!toFoundry.characteristics) toFoundry.characteristics = {};
                (toFoundry.characteristics as Record<string, unknown>)[foundryKey] = {
                    base: Number(kankaVal),
                };
            } else if (!isEmpty(foundryVal) && isEmpty(kankaVal)) {
                toKanka.set(kankaName, String(foundryVal));
            } else if (!isEmpty(foundryVal) && !isEmpty(kankaVal) && String(foundryVal) !== kankaVal) {
                conflicts.push(`${kankaName}: Foundry=${foundryVal}, Kanka=${kankaVal}`);
            }

            // Advances
            const foundryAdv = chars[foundryKey]?.advance;
            const kankaAdv = kankaAttrValue(kankaAttrs, `${kankaName}_advance`);
            if (isEmpty(foundryAdv) && !isEmpty(kankaAdv)) {
                if (!toFoundry.characteristics) toFoundry.characteristics = {};
                const existing = (toFoundry.characteristics as Record<string, unknown>)[foundryKey] as Record<string, unknown> | undefined;
                if (existing) {
                    existing.advance = Number(kankaAdv);
                } else {
                    (toFoundry.characteristics as Record<string, unknown>)[foundryKey] = {
                        advance: Number(kankaAdv),
                    };
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
            if (parts.length === 2) {
                if (!toFoundry[parts[0]]) toFoundry[parts[0]] = {};
                (toFoundry[parts[0]] as Record<string, unknown>)[parts[1]] = Number(kankaVal);
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
    const bio = system.bio as Record<string, unknown> | undefined;
    if (bio) {
        for (const [foundryKey, kankaName] of Object.entries(BIO_MAP)) {
            const foundryVal = bio[foundryKey];
            const kankaVal = kankaAttrValue(kankaAttrs, kankaName);

            if (isEmpty(foundryVal) && !isEmpty(kankaVal)) {
                if (!toFoundry.bio) toFoundry.bio = {};
                (toFoundry.bio as Record<string, unknown>)[foundryKey] = kankaVal;
            } else if (!isEmpty(foundryVal) && isEmpty(kankaVal)) {
                toKanka.set(kankaName, String(foundryVal));
            } else if (!isEmpty(foundryVal) && !isEmpty(kankaVal) && String(foundryVal) !== kankaVal) {
                conflicts.push(`${kankaName}: Foundry="${foundryVal}", Kanka="${kankaVal}"`);
            }
        }
    }

    // --- Origin Path ---
    const origin = system.originPath as Record<string, unknown> | undefined;
    if (origin) {
        for (const [foundryKey, kankaName] of Object.entries(ORIGIN_MAP)) {
            const foundryVal = origin[foundryKey];
            const kankaVal = kankaAttrValue(kankaAttrs, kankaName);

            if (isEmpty(foundryVal) && !isEmpty(kankaVal)) {
                if (!toFoundry.originPath) toFoundry.originPath = {};
                (toFoundry.originPath as Record<string, unknown>)[foundryKey] = kankaVal;
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
        const foundryVal = snapshotBuilders[key]();
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

    return { toKanka, toFoundry, conflicts };
}

/**
 * Check if a Foundry actor image path is a real, accessible image.
 * Verifies local paths actually exist by fetching them.
 */
async function hasFoundryImage(actor: Actor): Promise<boolean> {
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
async function downloadKankaImage(imageUrl: string, actorName: string): Promise<string | null> {
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
        const result = (await uploadResp.json()) as { path?: string };
        return result.path ?? `assets/portraits/${fileName}`;
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
async function reconcileImage(
    actor: Actor,
    campaignId: KankaApiId,
    kankaEntityId: KankaApiEntityId,
    kankaChildId: KankaApiId,
): Promise<void> {
    // Fetch entity data to get the current Kanka portrait
    let kankaEntity: { child?: { has_custom_image?: boolean; image_full?: string } };
    try {
        kankaEntity = await api.getEntity(campaignId, kankaEntityId) as typeof kankaEntity;
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
    const currentActor = (game as Game).actors?.get(actor.id ?? '') ?? actor;
    await syncTokenImage(currentActor, campaignId, kankaEntityId, portraitChanged);
}

/**
 * Reconcile a single actor with its Kanka entity.
 * Fills empty fields in both directions, warns on conflicts.
 */
async function reconcileActor(actor: Actor): Promise<void> {
    const kankaEntityId = actor.getFlag('kanka-foundry', 'kankaEntityId') as KankaApiEntityId | undefined;
    const kankaChildId = actor.getFlag('kanka-foundry', 'kankaChildId') as KankaApiId | undefined;
    const campaignId = actor.getFlag('kanka-foundry', 'campaign') as KankaApiId | undefined;
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
            await actor.update({ system: toFoundry } as Record<string, unknown>);
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

    const actors = (game as Game).actors?.filter(
        (a: Actor) => a.getFlag('kanka-foundry', 'kankaEntityId') !== undefined,
    ) ?? [];

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

    const kankaEntityId = actor.getFlag('kanka-foundry', 'kankaEntityId') as KankaApiEntityId | undefined;
    const campaignId = actor.getFlag('kanka-foundry', 'campaign') as KankaApiId | undefined;
    if (!kankaEntityId || !campaignId) return;

    const key = String(kankaEntityId);
    const existingTimer = pendingTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(async () => {
        pendingTimers.delete(key);
        const currentActor = (game as Game).actors?.get(actor.id!) ?? actor;
        await reconcileActor(currentActor);
    }, DEBOUNCE_MS);

    pendingTimers.set(key, timer);
}

function handleActorUpdate(actor: Actor, changes: Record<string, unknown>): void {
    if (!changes.system && !changes.name && !changes.img) return;

    // If portrait changed, re-sync token
    if (changes.img) {
        const eid = actor.getFlag('kanka-foundry', 'kankaEntityId') as KankaApiEntityId | undefined;
        const cid = actor.getFlag('kanka-foundry', 'campaign') as KankaApiId | undefined;
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

    const kankaEntityId = entry.getFlag('kanka-foundry', 'id');
    const campaignId = entry.getFlag('kanka-foundry', 'campaign');
    const snapshot = entry.getFlag('kanka-foundry', 'snapshot') as Record<string, unknown> | undefined;
    if (!kankaEntityId || !campaignId || !snapshot) return;
    if (changes.name === undefined) return;

    const childId = snapshot.id as KankaApiId;
    const key = `journal-${String(kankaEntityId)}`;
    const existingTimer = pendingTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(async () => {
        pendingTimers.delete(key);
        try {
            await api.updateCharacter(campaignId as KankaApiId, childId, { name: changes.name });
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
