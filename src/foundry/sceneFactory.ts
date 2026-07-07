import type { KankaApiEntityId, KankaApiId, KankaApiMapMarker } from '../types/kanka';
import { logInfo } from '../util/logger';
import { findEntryByEntityId } from './journalEntries';

/** New Scenes default to a 30px grid and zero padding (campaign convention). */
const GRID_SIZE = 30;

export interface KankaMapSceneInput {
    kankaMapId: KankaApiId;
    kankaEntityId: KankaApiEntityId;
    name: string;
    /** Kanka `image_full` URL — the Scene background HOTLINKS this; it is never downloaded. */
    backgroundUrl: string;
    /** Background image pixel dimensions; Kanka marker coords are in this pixel space. */
    width: number;
    height: number;
    markers: KankaApiMapMarker[];
}

/** A Foundry Scene already bound to this Kanka map (for idempotent re-import). */
function findSceneByKankaMap(kankaMapId: KankaApiId): Scene | undefined {
    return game.scenes?.find((scene) => scene.getFlag('kanka-foundry', 'kankaMapId') === kankaMapId) ?? undefined;
}

/**
 * Build Note embedded-document data from Kanka markers. Each marker's linked Kanka entity is
 * resolved to its synced Foundry JournalEntry (`marker.entity_id` → `findEntryByEntityId`); the
 * Note's x/y are the marker's pixel coordinates on the background image.
 */
function buildNoteData(markers: KankaApiMapMarker[]): object[] {
    return markers.map((marker) => {
        const entry = marker.entity_id !== null ? findEntryByEntityId(marker.entity_id) : undefined;
        return {
            x: Math.round(marker.longitude),
            y: Math.round(marker.latitude),
            entryId: entry?.id ?? null,
            text: marker.name ?? entry?.name ?? '',
            global: false,
        };
    });
}

// eslint-disable-next-line no-restricted-syntax -- boundary: heterogeneous Foundry Scene.create payload; Foundry validates the shape on write
function baseSceneData(input: KankaMapSceneInput): Record<string, unknown> {
    return {
        name: input.name,
        background: { src: input.backgroundUrl },
        width: input.width,
        height: input.height,
        padding: 0,
        grid: { size: GRID_SIZE },
        flags: { 'kanka-foundry': { kankaMapId: input.kankaMapId, kankaEntityId: input.kankaEntityId } },
    };
}

/** Delete a Scene's existing Notes and recreate them from the current markers (idempotent). */
async function refreshNotes(scene: Scene, markers: KankaApiMapMarker[]): Promise<void> {
    const ids = scene.notes.map((note) => note.id).filter((id): id is string => typeof id === 'string');
    if (ids.length > 0) await scene.deleteEmbeddedDocuments('Note', ids);
    const data = buildNoteData(markers);
    if (data.length > 0) await scene.createEmbeddedDocuments('Note', data);
}

/**
 * Import a Kanka map to a NEW Foundry Scene — background hotlinks the Kanka `image_full`, 30px
 * grid, zero padding, plus Note pins resolved to their entities' journals. Idempotent: re-binds
 * an existing Scene already flagged with this Kanka map id rather than duplicating it.
 */
export async function importKankaMapToNewScene(input: KankaMapSceneInput): Promise<Scene | undefined> {
    const existing = findSceneByKankaMap(input.kankaMapId);
    if (existing) {
        await existing.update(baseSceneData(input));
        await refreshNotes(existing, input.markers);
        logInfo(`Scene: updated "${input.name}" from Kanka map`);
        return existing;
    }
    // eslint-disable-next-line no-restricted-syntax -- boundary: Foundry's Scene.create static rejects our dynamic create payload; narrowed to the heterogeneous record baseSceneData emits
    const created = await (Scene.create as (data: Record<string, unknown>) => Promise<Scene | undefined>)(baseSceneData(input));
    if (created) {
        await refreshNotes(created, input.markers);
        logInfo(`Scene: created "${input.name}" from Kanka map`);
    }
    return created;
}

/**
 * Import a Kanka map by ADOPTING an existing GM-selected Scene: bind the map id + refresh the
 * pins, leaving the adopted Scene's own background/grid/padding untouched.
 */
export async function importKankaMapAdoptScene(input: KankaMapSceneInput, scene: Scene): Promise<Scene> {
    await scene.setFlag('kanka-foundry', 'kankaMapId', input.kankaMapId);
    await scene.setFlag('kanka-foundry', 'kankaEntityId', input.kankaEntityId);
    await refreshNotes(scene, input.markers);
    logInfo(`Scene: adopted "${scene.name}" for Kanka map`);
    return scene;
}
