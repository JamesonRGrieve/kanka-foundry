import { describe, expect, it } from 'vitest';
import type { KankaApiAttribute, KankaApiChildEntity, KankaApiMap, KankaApiMapMarker } from '../types/kanka';
import { buildInteriorSceneInput, findInteriorMap, isVehicleEntity } from './vehicleImport';

/** Cast a partial to its full shape — test mocks populate only the fields under test. */
function mock<T>(partial: Partial<T>): T {
    return partial as T;
}

function attr(name: string, value: string): KankaApiAttribute {
    return mock<KankaApiAttribute>({ name, value });
}

function entity(attributes: KankaApiAttribute[]): KankaApiChildEntity {
    return mock<KankaApiChildEntity>({ id: 1, entity_id: 100, name: 'The Errant Vector', attributes });
}

function map(over: Partial<KankaApiMap>): KankaApiMap {
    return mock<KankaApiMap>({ id: 5, name: 'Interior', location_id: 1, is_real: true, image_full: 'https://k/img.png', ...over });
}

describe('isVehicleEntity', () => {
    it('is true when a base_actor attribute is present', () => {
        expect(isVehicleEntity(entity([attr('base_actor', 'Compendium.wh40k-rpg.hb-dh2-actors-ships.Actor.abc')]))).toBe(true);
    });
    it('is false with no base_actor or an empty one', () => {
        expect(isVehicleEntity(entity([]))).toBe(false);
        expect(isVehicleEntity(entity([attr('base_actor', '   ')]))).toBe(false);
    });
});

describe('findInteriorMap', () => {
    it('finds the image map bound to the location', () => {
        const maps = [map({ id: 5, location_id: 1 }), map({ id: 6, location_id: 2 })];
        expect(findInteriorMap(maps, 1)?.id).toBe(5);
    });
    it('ignores maps for other locations', () => {
        expect(findInteriorMap([map({ location_id: 2 })], 1)).toBeUndefined();
    });
    it('ignores maps with no image (exterior placeholder / pending art)', () => {
        expect(findInteriorMap([map({ location_id: 1, image_full: '' })], 1)).toBeUndefined();
        expect(findInteriorMap([map({ location_id: 1, image_full: undefined })], 1)).toBeUndefined();
    });
});

describe('buildInteriorSceneInput', () => {
    const markers: KankaApiMapMarker[] = [];

    it('hotlinks image_full and names the scene "<vehicle> — Interior"', () => {
        const input = buildInteriorSceneInput('The Errant Vector', 100, map({ image_full: 'https://k/deck.png', width: 1600, height: 900 }), markers);
        expect(input.name).toBe('The Errant Vector — Interior');
        expect(input.backgroundUrl).toBe('https://k/deck.png');
        expect(input.kankaEntityId).toBe(100);
        expect(input.kankaMapId).toBe(5);
        expect(input.width).toBe(1600);
        expect(input.height).toBe(900);
    });

    it('falls back to a default canvas size when the map omits dimensions', () => {
        const input = buildInteriorSceneInput('The Errant Vector', 100, map({ width: undefined, height: undefined }), markers);
        expect(input.width).toBe(2000);
        expect(input.height).toBe(2000);
    });
});
