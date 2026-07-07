import api from '../../api';
import { type KankaMapSceneInput, importKankaMapAdoptScene, importKankaMapToNewScene } from '../../foundry/sceneFactory';
import type { KankaApiEntity, KankaApiId, KankaApiMap } from '../../types/kanka';
import { idToNumber } from './hierarchy';

/**
 * The Kanka map (if any) attached to a browsed entity, matched by the map's
 * `location_id` pointing at the entity's own child id. Only location/vehicle
 * entities carry a `location_id`-linked map, so this naturally returns nothing
 * for every other entity type.
 */
export function findMapForChild(maps: readonly KankaApiMap[], childId: KankaApiId): KankaApiMap | undefined {
    const target = idToNumber(childId);
    if (target === null) return undefined;
    return maps.find((map) => map.location_id !== null && idToNumber(map.location_id) === target);
}

/** True when the browsed entity has an importable Kanka map. */
export function entityHasMap(maps: readonly KankaApiMap[], entity: Pick<KankaApiEntity, 'child_id'>): boolean {
    return findMapForChild(maps, entity.child_id) !== undefined;
}

/**
 * Read a background image's intrinsic pixel dimensions by loading it in the
 * browser — Kanka marker coordinates live in this pixel space, so the Scene
 * canvas must match it exactly.
 */
export function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener('load', () => resolve({ width: image.naturalWidth, height: image.naturalHeight }));
        image.addEventListener('error', () => reject(new Error(`Failed to load Kanka map image: ${url}`)));
        image.src = url;
    });
}

/**
 * Resolve the Scene canvas size for a map: the background image's intrinsic
 * pixel size (authoritative — markers are placed in it), falling back to the
 * dimensions Kanka stores on the map when the image can't be loaded.
 */
export async function resolveMapDimensions(map: KankaApiMap): Promise<{ width: number; height: number }> {
    if (typeof map.image_full === 'string' && map.image_full.length > 0) {
        try {
            return await loadImageDimensions(map.image_full);
        } catch {
            // fall through to the stored dimensions
        }
    }

    if (typeof map.width === 'number' && typeof map.height === 'number') {
        return { width: map.width, height: map.height };
    }

    throw new Error('Kanka map has no resolvable image dimensions');
}

/**
 * Assemble the {@link KankaMapSceneInput} for a map: fetch its markers, resolve
 * its background dimensions, and hotlink its `image_full` as the Scene
 * background. Throws when the map carries no image.
 */
export async function buildMapSceneInput(campaignId: KankaApiId, map: KankaApiMap): Promise<KankaMapSceneInput> {
    if (typeof map.image_full !== 'string' || map.image_full.length === 0) {
        throw new Error('Kanka map has no image and cannot be imported');
    }

    const [markers, dimensions] = await Promise.all([api.getMapMarkers(campaignId, map.id), resolveMapDimensions(map)]);

    return {
        kankaMapId: map.id,
        kankaEntityId: map.entity_id,
        name: map.name,
        backgroundUrl: map.image_full,
        width: dimensions.width,
        height: dimensions.height,
        markers,
    };
}

/** Import a Kanka map to a brand-new Foundry Scene. */
export async function importMapToNewScene(campaignId: KankaApiId, map: KankaApiMap): Promise<Scene | undefined> {
    return importKankaMapToNewScene(await buildMapSceneInput(campaignId, map));
}

/** Import a Kanka map by adopting an existing GM-selected Scene. */
export async function importMapAdoptScene(campaignId: KankaApiId, map: KankaApiMap, scene: Scene): Promise<Scene> {
    return importKankaMapAdoptScene(await buildMapSceneInput(campaignId, map), scene);
}
