import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { importKankaMapAdoptScene, importKankaMapToNewScene } from '../../foundry/sceneFactory';
import type { KankaApiEntity, KankaApiMap } from '../../types/kanka';
import { buildMapSceneInput, entityHasMap, findMapForChild, importMapAdoptScene, importMapToNewScene } from './mapImport';

vi.mock('../../api', () => ({ default: { getMapMarkers: vi.fn() } }));
vi.mock('../../foundry/sceneFactory', () => ({
    importKankaMapToNewScene: vi.fn(),
    importKankaMapAdoptScene: vi.fn(),
}));

/** A fake DOM Image whose `src` setter immediately reports a fixed natural size. */
class FakeImage {
    naturalWidth = 1920;
    naturalHeight = 1080;
    #listeners: Record<string, Array<() => void>> = {};
    addEventListener(type: string, cb: () => void): void {
        (this.#listeners[type] ??= []).push(cb);
    }
    set src(_value: string) {
        queueMicrotask(() => {
            for (const cb of this.#listeners['load'] ?? []) cb();
        });
    }
}

function makeMap(overrides: Partial<KankaApiMap> = {}): KankaApiMap {
    return {
        id: 7,
        entity_id: 700,
        name: 'Solenne Minoris',
        location_id: 42,
        image_full: 'https://kanka.example/maps/solenne.webp',
        is_real: false,
        ...overrides,
    } as KankaApiMap;
}

function makeEntity(childId: number): Pick<KankaApiEntity, 'child_id'> {
    return { child_id: childId } as Pick<KankaApiEntity, 'child_id'>;
}

describe('findMapForChild / entityHasMap', () => {
    const maps = [makeMap({ id: 1, location_id: 42 }), makeMap({ id: 2, location_id: 99 })];

    it('matches a map to the entity whose child id equals its location_id', () => {
        expect(findMapForChild(maps, 42)?.id).toBe(1);
        expect(entityHasMap(maps, makeEntity(42))).toBe(true);
    });

    it('returns nothing for an entity with no matching map', () => {
        expect(findMapForChild(maps, 7)).toBeUndefined();
        expect(entityHasMap(maps, makeEntity(7))).toBe(false);
    });

    it('ignores maps with a null location_id', () => {
        expect(entityHasMap([makeMap({ location_id: null })], makeEntity(42))).toBe(false);
    });
});

describe('map import dispatch', () => {
    beforeEach(() => {
        vi.stubGlobal('Image', FakeImage);
        vi.mocked(api.getMapMarkers).mockResolvedValue([]);
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it('builds a scene input from the map, its markers and image dimensions', async () => {
        const markers = [{ id: 5 }] as unknown as Awaited<ReturnType<typeof api.getMapMarkers>>;
        vi.mocked(api.getMapMarkers).mockResolvedValue(markers);

        const input = await buildMapSceneInput(3, makeMap());

        expect(api.getMapMarkers).toHaveBeenCalledWith(3, 7);
        expect(input).toEqual({
            kankaMapId: 7,
            kankaEntityId: 700,
            name: 'Solenne Minoris',
            backgroundUrl: 'https://kanka.example/maps/solenne.webp',
            width: 1920,
            height: 1080,
            markers,
        });
    });

    it('dispatches "import to new scene" to the scene factory', async () => {
        await importMapToNewScene(3, makeMap());

        expect(importKankaMapToNewScene).toHaveBeenCalledTimes(1);
        expect(vi.mocked(importKankaMapToNewScene).mock.calls[0]?.[0]).toMatchObject({ kankaMapId: 7, backgroundUrl: expect.any(String) });
        expect(importKankaMapAdoptScene).not.toHaveBeenCalled();
    });

    it('dispatches "adopt existing scene" to the scene factory with the chosen scene', async () => {
        const scene = { id: 'scene-1', name: 'Existing' } as unknown as Scene;

        await importMapAdoptScene(3, makeMap(), scene);

        expect(importKankaMapAdoptScene).toHaveBeenCalledTimes(1);
        const call = vi.mocked(importKankaMapAdoptScene).mock.calls[0];
        expect(call?.[0]).toMatchObject({ kankaMapId: 7 });
        expect(call?.[1]).toBe(scene);
        expect(importKankaMapToNewScene).not.toHaveBeenCalled();
    });

    it('refuses to build an input for a map with no image', async () => {
        await expect(buildMapSceneInput(3, makeMap({ image_full: '' }))).rejects.toThrow(/no image/);
    });
});

describe('entity-list template renders the map-import actions', () => {
    const partials = ['entity-list.hbs', 'entity-grid.hbs'] as const;

    beforeAll(() => {
        Handlebars.registerHelper('kankaLocalize', (...args: unknown[]) => args.slice(0, -1).join('.'));
        Handlebars.registerHelper('ifThen', (cond: unknown, a: unknown, b: unknown) => (cond ? a : b));
        Handlebars.registerHelper('concat', (...args: unknown[]) => args.slice(0, -1).join(''));
    });

    afterAll(() => {
        Handlebars.unregisterHelper('kankaLocalize');
        Handlebars.unregisterHelper('ifThen');
        Handlebars.unregisterHelper('concat');
    });

    const context = {
        entities: [
            { id: 1, name: 'Mapped Location', child: {}, state: { hasMap: true, isLinked: false } },
            { id: 2, name: 'Plain Location', child: {}, state: { hasMap: false, isLinked: false } },
        ],
    };

    for (const partial of partials) {
        it(`renders both map actions exactly once (only for the map-bearing entity) in ${partial}`, () => {
            const source = readFileSync(new URL(`./templates/partials/${partial}`, import.meta.url), 'utf-8');
            const html = Handlebars.compile(source)(context);

            expect(html.match(/data-action="importMapNewScene"/g)).toHaveLength(1);
            expect(html.match(/data-action="importMapAdoptScene"/g)).toHaveLength(1);
        });
    }
});
