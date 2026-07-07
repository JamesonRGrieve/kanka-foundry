/**
 * Phase 3 — BIDIRECTIONAL map sync (Foundry → Kanka).
 *
 * The import side (`sceneFactory`) pulls a Kanka map into a Foundry Scene: the
 * background hotlinks the map image and each Kanka map-marker becomes a Note pin
 * (marker `longitude`→`x`, `latitude`→`y`, linked entity→the pin's JournalEntry).
 * This module is the reverse leg — when a GM edits the Notes on a Scene that is
 * flagged with `kanka-foundry.kankaMapId`, the change is pushed back to the
 * Kanka map's markers (create / update / delete), and a Scene rename is pushed
 * to the map's name.
 *
 * Conflict discipline mirrors the actor `syncBack` reconcile exactly: a marker
 * that diverged on BOTH ends (Kanka changed it out-of-band since we last pushed,
 * AND Foundry changed it) is NEVER silently overwritten — the local value is
 * kept, a warning is logged, and a record is surfaced through the shared conflict
 * store for the GM to resolve. Only a Foundry-only change (Kanka still matches the
 * last-synced baseline) is pushed.
 *
 * Kanka WRITE endpoints for map markers are not part of the read-only foundation
 * `KankaApi`, so this file carries a thin authenticated writer built on the same
 * `KankaFetcher` HTTP path the API layer uses. Promoting `createMapMarker` /
 * `updateMapMarker` / `deleteMapMarker` / `updateMap` into `KankaApi` is the
 * cleaner long-term home (see the module note at the bottom).
 */

import api from '../api';
import KankaFetcher from '../api/KankaFetcher';
import type { KankaApiEntityId, KankaApiId, KankaApiMapMarker, KankaApiResult } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
import { asRecord, readFunction, readProp, readString } from '../util/reflection';
import { addConflicts } from './conflicts/conflictStore';
import { type StoredConflict, conflictId } from './conflicts/types';

/** Kanka point-marker shape id (a single pin, matching the import shape). */
const MARKER_SHAPE_POINT = 1;

/** Default Kanka marker icon id used when neither Kanka nor Foundry carries one. */
const DEFAULT_MARKER_ICON = '1';

const FLAG_SCOPE = 'kanka-foundry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The marker payload written to Kanka. Mirrors the Kanka create shape; `latitude`
 *  is the Note's `y`, `longitude` is the Note's `x`. */
export interface MarkerWritePayload {
    map_id: KankaApiId;
    latitude: number;
    longitude: number;
    entity_id: KankaApiEntityId | null;
    name: string | null;
    shape_id: number;
    icon: string | null;
}

/** The comparable core of a marker, used to detect divergence on either end. */
interface MarkerCore {
    latitude: number;
    longitude: number;
    entity_id: number | null;
    name: string | null;
    icon: string | null;
    shape_id: number;
}

/** The last-synced marker snapshot we stored on the Note after a successful push.
 *  Used to tell a Foundry-only edit (Kanka still == baseline) apart from a both-
 *  ends conflict (Kanka drifted from baseline). */
type MarkerBaseline = MarkerCore;

/** The decision produced from (desired Foundry state, current Kanka marker, baseline). */
export type MarkerSyncAction =
    | { type: 'create'; payload: MarkerWritePayload }
    | { type: 'update'; markerId: KankaApiId; payload: MarkerWritePayload }
    | { type: 'delete'; markerId: KankaApiId }
    | { type: 'conflict'; existing: KankaApiMapMarker; desired: MarkerWritePayload | null }
    | { type: 'noop' };

// ---------------------------------------------------------------------------
// Pure comparison / decision helpers (no Foundry / Kanka globals — unit-testable)
// ---------------------------------------------------------------------------

/** Coords are placed at integer pixels; compare rounded so float drift on the
 *  Kanka side does not read as a spurious change. */
function coordsEqual(a: number, b: number): boolean {
    return Math.round(a) === Math.round(b);
}

function markerToCore(marker: KankaApiMapMarker): MarkerCore {
    const entityId = marker.entity_id;
    return {
        latitude: marker.latitude,
        longitude: marker.longitude,
        entity_id: typeof entityId === 'number' ? entityId : null,
        name: marker.name ?? null,
        icon: marker.icon ?? null,
        shape_id: marker.shape_id,
    };
}

function payloadToCore(payload: MarkerWritePayload): MarkerCore {
    const entityId = payload.entity_id;
    return {
        latitude: payload.latitude,
        longitude: payload.longitude,
        entity_id: typeof entityId === 'number' ? entityId : null,
        name: payload.name ?? null,
        icon: payload.icon ?? null,
        shape_id: payload.shape_id,
    };
}

function coreEquals(a: MarkerCore, b: MarkerCore): boolean {
    return (
        coordsEqual(a.latitude, b.latitude) &&
        coordsEqual(a.longitude, b.longitude) &&
        a.entity_id === b.entity_id &&
        a.name === b.name &&
        a.icon === b.icon &&
        a.shape_id === b.shape_id
    );
}

/**
 * Decide what to push to Kanka for one Note, mirroring the actor reconcile's
 * "fill / push only when the other side hasn't independently changed, else
 * conflict" contract:
 *
 * - `desired === null` (Note deleted): delete the marker, unless Kanka drifted
 *   from the baseline (→ conflict, don't blindly discard a Kanka edit).
 * - no existing Kanka marker: create.
 * - existing already equals desired: noop (in sync).
 * - existing still equals the last-synced baseline (or none recorded yet):
 *   Foundry-only change → update.
 * - existing diverged from BOTH baseline and desired: both ends changed →
 *   conflict (keep local, surface, never overwrite).
 */
export function decideMarkerSync(
    desired: MarkerWritePayload | null,
    existing: KankaApiMapMarker | undefined,
    baseline: MarkerBaseline | undefined,
): MarkerSyncAction {
    if (desired === null) {
        if (!existing) return { type: 'noop' };
        if (baseline !== undefined && !coreEquals(markerToCore(existing), baseline)) {
            return { type: 'conflict', existing, desired: null };
        }
        return { type: 'delete', markerId: existing.id };
    }

    if (!existing) return { type: 'create', payload: desired };

    const existingCore = markerToCore(existing);
    if (coreEquals(existingCore, payloadToCore(desired))) return { type: 'noop' };

    const kankaUnchanged = baseline === undefined || coreEquals(existingCore, baseline);
    if (kankaUnchanged) return { type: 'update', markerId: existing.id, payload: desired };

    return { type: 'conflict', existing, desired };
}

// ---------------------------------------------------------------------------
// Thin authenticated writer (Kanka map-marker + map writes)
// ---------------------------------------------------------------------------

let cachedFetcher: KankaFetcher | undefined;

/** Build (once) a fetcher on the same authenticated HTTP path the API layer uses,
 *  refreshing the token each call. Returns undefined when no token is available. */
function markerFetcher(): KankaFetcher | undefined {
    const token = api.getToken();
    if (!token) return undefined;
    if (!cachedFetcher) cachedFetcher = new KankaFetcher(api.baseUrl);
    cachedFetcher.token = token;
    return cachedFetcher;
}

function markersPath(campaignId: KankaApiId, mapId: KankaApiId): string {
    // Nested under the map to match the read path (`KankaApi.getMapMarkers`) and
    // Kanka's real endpoint shape (`.../maps/{map}/map_markers`).
    return `campaigns/${String(campaignId)}/maps/${String(mapId)}/map_markers`;
}

export async function createMapMarker(campaignId: KankaApiId, mapId: KankaApiId, payload: MarkerWritePayload): Promise<KankaApiMapMarker | undefined> {
    const fetcher = markerFetcher();
    if (!fetcher) return undefined;
    const result = await fetcher.post<KankaApiResult<KankaApiMapMarker>>(markersPath(campaignId, mapId), payload);
    return result.data;
}

export async function updateMapMarker(
    campaignId: KankaApiId,
    mapId: KankaApiId,
    markerId: KankaApiId,
    payload: MarkerWritePayload,
): Promise<KankaApiMapMarker | undefined> {
    const fetcher = markerFetcher();
    if (!fetcher) return undefined;
    const result = await fetcher.patch<KankaApiResult<KankaApiMapMarker>>(`${markersPath(campaignId, mapId)}/${String(markerId)}`, payload);
    return result.data;
}

export async function deleteMapMarker(campaignId: KankaApiId, mapId: KankaApiId, markerId: KankaApiId): Promise<void> {
    const fetcher = markerFetcher();
    if (!fetcher) return;
    await fetcher.delete(`${markersPath(campaignId, mapId)}/${String(markerId)}`);
}

export async function updateMap(campaignId: KankaApiId, mapId: KankaApiId, data: { name: string }): Promise<void> {
    const fetcher = markerFetcher();
    if (!fetcher) return;
    await fetcher.patch<KankaApiResult<unknown>>(`campaigns/${String(campaignId)}/maps/${String(mapId)}`, data);
}

// ---------------------------------------------------------------------------
// Foundry document readers (defensive — tolerant of test stubs and real docs)
// ---------------------------------------------------------------------------

function readFlag(doc: unknown, key: string): unknown {
    const getFlag = readFunction<(scope: string, k: string) => unknown>(doc, 'getFlag');
    if (getFlag) return getFlag.call(doc, FLAG_SCOPE, key);
    const flags = asRecord(readProp(doc, 'flags'));
    const kanka = flags ? asRecord(flags[FLAG_SCOPE]) : undefined;
    return kanka?.[key];
}

async function writeFlag(doc: unknown, key: string, value: unknown): Promise<void> {
    const setFlag = readFunction<(scope: string, k: string, v: unknown) => Promise<unknown>>(doc, 'setFlag');
    if (!setFlag) return;
    await setFlag.call(doc, FLAG_SCOPE, key, value);
}

async function clearFlag(doc: unknown, key: string): Promise<void> {
    const unsetFlag = readFunction<(scope: string, k: string) => Promise<unknown>>(doc, 'unsetFlag');
    if (!unsetFlag) return;
    await unsetFlag.call(doc, FLAG_SCOPE, key);
}

function readNumber(target: unknown, key: string): number | undefined {
    const v = readProp(target, key);
    return typeof v === 'number' ? v : undefined;
}

/** The Scene that owns a Note (its `parent`), if it is a Kanka-map-flagged scene. */
function ownerScene(note: unknown): unknown {
    const scene = readProp(note, 'parent');
    const hasGetFlag = readFunction<(scope: string, k: string) => unknown>(scene, 'getFlag') !== undefined;
    if (!hasGetFlag && asRecord(readProp(scene, 'flags')) === undefined) return undefined;
    return scene;
}

function readMapId(scene: unknown): KankaApiId | undefined {
    const raw = readFlag(scene, 'kankaMapId');
    return typeof raw === 'number' ? raw : undefined;
}

/** Resolve a Note's linked JournalEntry (`entryId`) to its Kanka `entity_id`. */
function entityIdForNote(note: unknown): KankaApiEntityId | null {
    const entryId = readString(note, 'entryId');
    if (!entryId) return null;
    const journal = readProp(game, 'journal');
    const get = readFunction<(id: string) => unknown>(journal, 'get');
    const entry = get ? get.call(journal, entryId) : undefined;
    if (entry === undefined || entry === null) return null;
    const id = readFlag(entry, 'id');
    return typeof id === 'number' ? id : null;
}

function currentCampaignId(): KankaApiId | undefined {
    const settings = readProp(game, 'settings');
    const get = readFunction<(ns: string, k: string) => unknown>(settings, 'get');
    if (!get) return undefined;
    const raw = get.call(settings, FLAG_SCOPE, 'campaign');
    const str = typeof raw === 'string' ? raw : String(raw ?? '');
    if (!str) return undefined;
    const num = Number(str);
    return Number.isFinite(num) && num !== 0 ? num : undefined;
}

/** Foundry → Kanka sync is GM-only and requires an authenticated, ready API. */
function syncEnabled(): boolean {
    if (!api.isReady) return false;
    return readProp(readProp(game, 'user'), 'isGM') === true;
}

function readBaseline(note: unknown): MarkerBaseline | undefined {
    const rec = asRecord(readFlag(note, 'markerSnapshot'));
    if (!rec) return undefined;
    const latitude = rec['latitude'];
    const longitude = rec['longitude'];
    const shapeId = rec['shape_id'];
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || typeof shapeId !== 'number') return undefined;
    const entityId = rec['entity_id'];
    const name = rec['name'];
    const icon = rec['icon'];
    return {
        latitude,
        longitude,
        shape_id: shapeId,
        entity_id: typeof entityId === 'number' ? entityId : null,
        name: typeof name === 'string' ? name : null,
        icon: typeof icon === 'string' ? icon : null,
    };
}

// ---------------------------------------------------------------------------
// Marker payload + existing-marker matching
// ---------------------------------------------------------------------------

function buildMarkerPayload(note: unknown, mapId: KankaApiId, existingIcon: string | null): MarkerWritePayload {
    const x = readNumber(note, 'x') ?? 0;
    const y = readNumber(note, 'y') ?? 0;
    const text = readString(note, 'text');
    return {
        map_id: mapId,
        latitude: y,
        longitude: x,
        entity_id: entityIdForNote(note),
        name: text && text.length > 0 ? text : null,
        shape_id: MARKER_SHAPE_POINT,
        icon: existingIcon ?? DEFAULT_MARKER_ICON,
    };
}

/** Locate the Kanka marker this Note maps to: by stored marker id first, then by
 *  linked entity id. Undefined means "no marker yet" (→ create). */
function findExistingMarker(note: unknown, markers: KankaApiMapMarker[], desiredEntityId: KankaApiEntityId | null): KankaApiMapMarker | undefined {
    const storedId = readFlag(note, 'kankaMarkerId');
    if (typeof storedId === 'number') {
        const byId = markers.find((m) => m.id === storedId);
        if (byId) return byId;
    }
    if (typeof desiredEntityId === 'number') {
        return markers.find((m) => m.entity_id === desiredEntityId);
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Conflict surfacing (shared store — keep local, warn, never overwrite)
// ---------------------------------------------------------------------------

function buildMarkerConflict(scene: unknown, note: unknown, existing: KankaApiMapMarker, desired: MarkerWritePayload | null): StoredConflict {
    const sceneId = readString(scene, 'id') ?? '';
    const noteId = readString(note, 'id') ?? '';
    return {
        // NOTE: the shared StoredConflict schema only models `actor` / `campaign`
        // entity types. A scene/marker conflict is recorded under the `actor` shape
        // (safe-degrading: the resolver's actor apply/recompute paths no-op on an id
        // that matches no actor). A first-class `scene` entityType + `marker` kind in
        // `conflicts/types.ts` and a dispatch branch in `resolveConflicts.ts` is the
        // proper home — see the module note at the bottom.
        id: conflictId('actor', `scene:${sceneId}`, `marker:${noteId}`),
        kind: 'rootString',
        entityType: 'actor',
        entityId: `scene:${sceneId}:${noteId}`,
        entityName: readString(scene, 'name') ?? sceneId,
        label: `Map marker: ${readString(note, 'text') ?? noteId}`,
        kankaAttr: '',
        foundryPath: '',
        kankaValue: JSON.stringify(markerToCore(existing)),
        foundryValue: desired ? JSON.stringify(payloadToCore(desired)) : 'deleted',
    };
}

async function surfaceMarkerConflict(scene: unknown, note: unknown, existing: KankaApiMapMarker, desired: MarkerWritePayload | null): Promise<void> {
    const conflict = buildMarkerConflict(scene, note, existing, desired);
    await addConflicts([conflict]);
    console.warn(`[kanka-foundry] MARKER CONFLICT on "${conflict.entityName}": Foundry=${conflict.foundryValue}, Kanka=${conflict.kankaValue}`);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

type NoteChangeKind = 'upsert' | 'delete';

/**
 * Reconcile one Note against its Kanka map marker. `kind: 'delete'` handles the
 * deleteNote hook (the Note is already gone; only its flags/coords as captured by
 * Foundry are available). Exported for tests and future callers.
 */
export async function reconcileSceneNote(note: unknown, kind: NoteChangeKind = 'upsert'): Promise<void> {
    if (!syncEnabled()) return;

    const scene = ownerScene(note);
    if (scene === undefined) return;
    const mapId = readMapId(scene);
    if (mapId === undefined) return;
    const campaignId = currentCampaignId();
    if (campaignId === undefined) return;

    let markers: KankaApiMapMarker[];
    try {
        markers = await api.getMapMarkers(campaignId, mapId);
    } catch (error) {
        logError('Failed to fetch Kanka map markers for scene sync-back', error);
        return;
    }

    const desiredEntityId = kind === 'delete' ? null : entityIdForNote(note);
    const existing = findExistingMarker(note, markers, desiredEntityId);
    const desired = kind === 'delete' ? null : buildMarkerPayload(note, mapId, existing?.icon ?? null);
    const baseline = readBaseline(note);

    const action = decideMarkerSync(desired, existing, baseline);

    try {
        switch (action.type) {
            case 'create': {
                const created = await createMapMarker(campaignId, mapId, action.payload);
                if (created) {
                    await writeFlag(note, 'kankaMarkerId', created.id);
                    await writeFlag(note, 'markerSnapshot', markerToCore(created));
                }
                logInfo(`Scene sync-back: created Kanka marker for "${readString(scene, 'name') ?? ''}"`);
                break;
            }
            case 'update': {
                const updated = await updateMapMarker(campaignId, mapId, action.markerId, action.payload);
                await writeFlag(note, 'kankaMarkerId', action.markerId);
                await writeFlag(note, 'markerSnapshot', updated ? markerToCore(updated) : payloadToCore(action.payload));
                logInfo(`Scene sync-back: updated Kanka marker ${String(action.markerId)}`);
                break;
            }
            case 'delete': {
                await deleteMapMarker(campaignId, mapId, action.markerId);
                await clearFlag(note, 'kankaMarkerId');
                await clearFlag(note, 'markerSnapshot');
                logInfo(`Scene sync-back: deleted Kanka marker ${String(action.markerId)}`);
                break;
            }
            case 'conflict': {
                await surfaceMarkerConflict(scene, note, action.existing, action.desired);
                break;
            }
            case 'noop':
                break;
        }
    } catch (error) {
        logError('Scene sync-back marker write failed', error);
    }
}

/** True when a Note update touched a marker-relevant field (position / link / label). */
function noteChangeIsRelevant(changes: unknown): boolean {
    const rec = asRecord(changes);
    if (!rec) return false;
    return rec['x'] !== undefined || rec['y'] !== undefined || rec['entryId'] !== undefined || rec['text'] !== undefined;
}

/** Push a Scene rename to the Kanka map name (conflict-guarded via a stored baseline). */
export async function reconcileSceneName(scene: unknown): Promise<void> {
    if (!syncEnabled()) return;
    const mapId = readMapId(scene);
    if (mapId === undefined) return;
    const campaignId = currentCampaignId();
    if (campaignId === undefined) return;
    const newName = readString(scene, 'name');
    if (!newName) return;

    let kankaName = '';
    try {
        const map = await api.getMap(campaignId, mapId);
        kankaName = readString(map, 'name') ?? '';
    } catch (error) {
        logError('Failed to fetch Kanka map for scene rename sync-back', error);
        return;
    }

    if (kankaName === newName) return; // already in sync

    const baselineName = readFlag(scene, 'mapNameSnapshot');
    if (typeof baselineName === 'string' && kankaName !== baselineName) {
        // Kanka name drifted from the last-synced baseline AND Foundry renamed:
        // both ends changed — keep local, warn, never overwrite.
        console.warn(`[kanka-foundry] MAP NAME CONFLICT: Foundry="${newName}", Kanka="${kankaName}"`);
        return;
    }

    try {
        await updateMap(campaignId, mapId, { name: newName });
        await writeFlag(scene, 'mapNameSnapshot', newName);
        logInfo(`Scene sync-back: renamed Kanka map to "${newName}"`);
    } catch (error) {
        logError('Scene sync-back map rename failed', error);
    }
}

// ---------------------------------------------------------------------------
// Hook registration
// ---------------------------------------------------------------------------

/**
 * Register the Foundry Scene/Note change hooks that drive Foundry → Kanka map
 * sync. Gated at fire-time by `syncEnabled()` (GM + authenticated). There is no
 * dedicated `syncBackMaps` setting yet (the actor/journal legs each have one) —
 * adding one to `settings.ts` is the clean follow-up; until then this leg is
 * always-on for a GM with sync-back credentials.
 */
export function registerSceneSyncBackHooks(): void {
    Hooks.on('createNote', (note: unknown) => {
        void reconcileSceneNote(note, 'upsert');
    });
    Hooks.on('updateNote', (note: unknown, changes: unknown) => {
        if (noteChangeIsRelevant(changes)) void reconcileSceneNote(note, 'upsert');
    });
    Hooks.on('deleteNote', (note: unknown) => {
        void reconcileSceneNote(note, 'delete');
    });
    Hooks.on('updateScene', (scene: unknown, changes: unknown) => {
        if (asRecord(changes)?.['name'] !== undefined) void reconcileSceneName(scene);
    });
}

/*
 * FOLLOW-UP (out of the scope this file was allowed to touch):
 *   1. Kanka write methods — `createMapMarker` / `updateMapMarker` /
 *      `deleteMapMarker` / `updateMap` belong on `KankaApi` alongside the other
 *      write methods (they already share the `#fetcher`); this file re-instantiates
 *      a `KankaFetcher` only because that private fetcher is not exposed.
 *   2. Conflict typing — a first-class `scene` `ConflictEntityType` + `marker`
 *      `ConflictKind` in `conflicts/types.ts`, plus a dispatch branch in
 *      `resolveConflicts.ts` (apply = push/delete the chosen marker; revalidate =
 *      re-fetch the marker), would let marker conflicts round-trip and persist
 *      across sessions like actor/campaign ones. They are currently recorded under
 *      the `actor` shape as a safe-degrading placeholder.
 *   3. A `syncBackMaps` world setting in `settings.ts` to gate this leg, matching
 *      `syncBackActors` / `syncBackJournals`.
 */
