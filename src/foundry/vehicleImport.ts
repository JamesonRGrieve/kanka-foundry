import api from '../api';
import type { KankaApiCharacter, KankaApiChildEntity, KankaApiEntityId, KankaApiId, KankaApiMap, KankaApiMapMarker } from '../types/kanka';
import { logInfo } from '../util/logger';
import { createOrUpdateActor, getStringAttribute } from './actorFactory';
import { importKankaMapToNewScene, type KankaMapSceneInput } from './sceneFactory';

/**
 * Vehicle import (dual-nature vehicles).
 *
 * In Kanka a vehicle is a **Location** carrying a `base_actor` attribute (the
 * compendium chassis to clone). When the GM imports it, we emit BOTH a Foundry
 * Actor (from the base chassis) AND — if the location has an interior image map —
 * a walkable-interior Scene, cross-linked by a flag so the actor sheet can board
 * it. This runs only on the GM-triggered import path (syncEntities.handleEntity),
 * never on a background sync.
 */

const FLAG_SCOPE = 'kanka-foundry';
/** Flag on the vehicle Actor pointing at its interior Scene (read by the wh40k-rpg system). */
export const INTERIOR_SCENE_FLAG = 'interiorSceneId';
/** Reverse flag on the interior Scene pointing back at its vehicle Actor. */
export const VEHICLE_ACTOR_FLAG = 'vehicleActorId';
/** Fallback Scene canvas size when the Kanka map omits pixel dimensions. */
const DEFAULT_MAP_DIMENSION = 2000;

/** True when a Kanka Location is a vehicle — i.e. it carries a non-empty `base_actor` attribute. */
export function isVehicleEntity(entity: KankaApiChildEntity): boolean {
    return getStringAttribute(entity.attributes, 'base_actor').trim() !== '';
}

/**
 * The interior image map bound to this location, if any. A vehicle's interior is
 * an image map (`image_full` set) bound to the location by `location_id`; the
 * exterior/approach variant (no image, or a non-matching binding) is skipped.
 */
export function findInteriorMap(maps: KankaApiMap[], locationChildId: KankaApiId): KankaApiMap | undefined {
    return maps.find(
        (map) => map.location_id !== null && Number(map.location_id) === Number(locationChildId) && typeof map.image_full === 'string' && map.image_full !== '',
    );
}

/** Build the Scene-import payload for a vehicle's interior map. */
export function buildInteriorSceneInput(vehicleName: string, entityId: KankaApiEntityId, map: KankaApiMap, markers: KankaApiMapMarker[]): KankaMapSceneInput {
    return {
        kankaMapId: map.id,
        kankaEntityId: entityId,
        name: `${vehicleName} — Interior`,
        backgroundUrl: map.image_full ?? '',
        width: map.width ?? DEFAULT_MAP_DIMENSION,
        height: map.height ?? DEFAULT_MAP_DIMENSION,
        markers,
    };
}

/**
 * GM-triggered vehicle import: clone the Actor from its base chassis, then — when
 * an interior image map exists — build the interior Scene and cross-link the two.
 * A vehicle with no interior map (or pending art) imports as an Actor only.
 */
export async function importVehicle(
    entity: KankaApiChildEntity,
    entityTags: string[],
    campaignId: KankaApiId,
    defaultActorType: string,
    pcTags: string[],
    gameSystem: string,
): Promise<void> {
    // The base_actor chassis makes this a real Actor; createOrUpdateActor reads
    // the same attributes/name/entity_id a character exposes, so a vehicle Location
    // is structurally sufficient here. The base chassis' own actor type wins.
    // eslint-disable-next-line no-restricted-syntax -- boundary: reuse the actor factory for a Location that carries a base_actor; only the shared KankaApiChildEntity fields are read
    const actor = await createOrUpdateActor(entity as unknown as KankaApiCharacter, entityTags, campaignId, defaultActorType, pcTags, gameSystem);

    const maps = await api.getAllMaps(campaignId);
    const interior = findInteriorMap(maps, entity.id);
    if (!interior) {
        logInfo(`Vehicle "${entity.name}": no interior map — imported as Actor only`);
        return;
    }

    const markers = await api.getMapMarkers(campaignId, interior.id);
    const scene = await importKankaMapToNewScene(buildInteriorSceneInput(entity.name, entity.entity_id, interior, markers));
    if (scene && typeof scene.id === 'string' && scene.id !== '') {
        await actor.setFlag(FLAG_SCOPE, INTERIOR_SCENE_FLAG, scene.id);
        if (typeof actor.id === 'string' && actor.id !== '') {
            await scene.setFlag(FLAG_SCOPE, VEHICLE_ACTOR_FLAG, actor.id);
        }
        logInfo(`Vehicle "${entity.name}": linked interior Scene "${scene.name}"`);
    }
}
