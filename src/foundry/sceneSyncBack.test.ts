import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KankaApiMapMarker } from '../types/kanka';
import { addConflicts } from './conflicts/conflictStore';
import { type MarkerWritePayload, decideMarkerSync, reconcileSceneNote, registerSceneSyncBackHooks } from './sceneSyncBack';

// Spies shared with the mocked KankaFetcher (hoisted so the vi.mock factory can reach them).
const { post, patch, del } = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), del: vi.fn() }));

vi.mock('../api/KankaFetcher', () => ({
    default: class {
        token: unknown;
        base = '';
        constructor(_base: string) {}
        post = post;
        patch = patch;
        delete = del;
    },
}));

vi.mock('../api', () => ({
    default: {
        isReady: true,
        baseUrl: 'https://api.kanka.io/1.0/',
        getToken: vi.fn(() => ({ toString: () => 'tok' })),
        getMapMarkers: vi.fn(),
        getMap: vi.fn(),
    },
}));

vi.mock('./conflicts/conflictStore', () => ({ addConflicts: vi.fn(() => Promise.resolve()) }));
vi.mock('../util/logger', () => ({ logInfo: vi.fn(), logError: vi.fn() }));

// Import after the mocks so the mocked default is what the module under test uses.
import api from '../api';

function marker(overrides: Partial<KankaApiMapMarker> = {}): KankaApiMapMarker {
    return {
        id: 55,
        map_id: 7,
        entity_id: null,
        name: 'Old Pin',
        latitude: 500,
        longitude: 500,
        colour: null,
        shape_id: 1,
        icon: '1',
        is_draggable: true,
        ...overrides,
    };
}

function payload(overrides: Partial<MarkerWritePayload> = {}): MarkerWritePayload {
    return { map_id: 7, latitude: 340, longitude: 120, entity_id: null, name: 'The Lair', shape_id: 1, icon: '1', ...overrides };
}

type Flags = Record<string, unknown>;

function makeScene(flags: Flags = { kankaMapId: 7 }): Record<string, unknown> {
    return {
        id: 'scene1',
        name: 'Solenne Minoris',
        getFlag: (_scope: string, key: string): unknown => flags[key],
        setFlag: vi.fn(() => Promise.resolve()),
    };
}

function makeNote(scene: unknown, flags: Flags = {}, fields: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'note1',
        x: 120,
        y: 340,
        entryId: null,
        text: 'The Lair',
        parent: scene,
        getFlag: (_scope: string, key: string): unknown => flags[key],
        setFlag: vi.fn(() => Promise.resolve()),
        unsetFlag: vi.fn(() => Promise.resolve()),
        ...fields,
    };
}

beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: marker({ id: 999, latitude: 340, longitude: 120, name: 'The Lair' }) });
    patch.mockReset().mockResolvedValue({ data: marker({ id: 55, latitude: 340, longitude: 120, name: 'The Lair' }) });
    del.mockReset().mockResolvedValue(undefined);
    vi.mocked(addConflicts).mockClear();

    vi.stubGlobal('game', {
        user: { isGM: true },
        settings: { get: (_ns: string, key: string): string => (key === 'campaign' ? '42' : '') },
        journal: { get: (): undefined => undefined },
    });
    vi.stubGlobal('Hooks', { on: vi.fn() });
});

describe('decideMarkerSync', () => {
    it('creates when Kanka has no marker yet', () => {
        expect(decideMarkerSync(payload(), undefined, undefined)).toEqual({ type: 'create', payload: payload() });
    });

    it('updates a Foundry-only change (Kanka still matches the baseline)', () => {
        const existing = marker({ latitude: 500, longitude: 500 });
        const baseline = { latitude: 500, longitude: 500, entity_id: null, name: 'Old Pin', icon: '1', shape_id: 1 };
        const action = decideMarkerSync(payload(), existing, baseline);
        expect(action).toEqual({ type: 'update', markerId: 55, payload: payload() });
    });

    it('updates when no baseline is recorded yet and values differ', () => {
        const action = decideMarkerSync(payload(), marker({ latitude: 500, longitude: 500 }), undefined);
        expect(action.type).toBe('update');
    });

    it('is a noop when Kanka already matches the desired marker', () => {
        const existing = marker({ latitude: 340, longitude: 120, name: 'The Lair' });
        expect(decideMarkerSync(payload(), existing, undefined).type).toBe('noop');
    });

    it('surfaces a conflict when BOTH ends diverged from the baseline', () => {
        const existing = marker({ latitude: 900, longitude: 900, name: 'Moved In Kanka' });
        const baseline = { latitude: 500, longitude: 500, entity_id: null, name: 'Old Pin', icon: '1', shape_id: 1 };
        const action = decideMarkerSync(payload(), existing, baseline);
        expect(action.type).toBe('conflict');
    });

    it('deletes when the Note is gone and Kanka still matches the baseline', () => {
        const existing = marker({ latitude: 500, longitude: 500 });
        const baseline = { latitude: 500, longitude: 500, entity_id: null, name: 'Old Pin', icon: '1', shape_id: 1 };
        expect(decideMarkerSync(null, existing, baseline)).toEqual({ type: 'delete', markerId: 55 });
    });

    it('conflicts on delete when Kanka drifted from the baseline', () => {
        const existing = marker({ latitude: 900 });
        const baseline = { latitude: 500, longitude: 500, entity_id: null, name: 'Old Pin', icon: '1', shape_id: 1 };
        expect(decideMarkerSync(null, existing, baseline).type).toBe('conflict');
    });
});

describe('reconcileSceneNote', () => {
    it('emits a Kanka marker create write for a new Note on a flagged Scene', async () => {
        vi.mocked(api.getMapMarkers).mockResolvedValue([]);
        const scene = makeScene();
        const note = makeNote(scene);

        await reconcileSceneNote(note, 'upsert');

        expect(post).toHaveBeenCalledTimes(1);
        const [path, body] = post.mock.calls[0] ?? [];
        expect(path).toBe('campaigns/42/maps/7/map_markers');
        expect(body).toMatchObject({ map_id: 7, latitude: 340, longitude: 120, shape_id: 1, name: 'The Lair' });
        expect(vi.mocked(addConflicts)).not.toHaveBeenCalled();
        // baseline is persisted on the Note so the next edit is conflict-aware
        expect(note['setFlag']).toHaveBeenCalledWith('kanka-foundry', 'kankaMarkerId', 999);
    });

    it('pushes an update when only Foundry changed (Kanka matches the baseline)', async () => {
        vi.mocked(api.getMapMarkers).mockResolvedValue([marker({ id: 55, latitude: 500, longitude: 500 })]);
        const scene = makeScene();
        const note = makeNote(scene, {
            kankaMarkerId: 55,
            markerSnapshot: { latitude: 500, longitude: 500, entity_id: null, name: 'Old Pin', icon: '1', shape_id: 1 },
        });

        await reconcileSceneNote(note, 'upsert');

        expect(patch).toHaveBeenCalledTimes(1);
        expect(patch.mock.calls[0]?.[0]).toBe('campaigns/42/maps/7/map_markers/55');
        expect(vi.mocked(addConflicts)).not.toHaveBeenCalled();
    });

    it('surfaces a conflict and does NOT write when the marker changed on both ends', async () => {
        vi.mocked(api.getMapMarkers).mockResolvedValue([marker({ id: 55, latitude: 900, longitude: 900, name: 'Moved In Kanka' })]);
        const scene = makeScene();
        const note = makeNote(scene, {
            kankaMarkerId: 55,
            markerSnapshot: { latitude: 500, longitude: 500, entity_id: null, name: 'Old Pin', icon: '1', shape_id: 1 },
        });

        await reconcileSceneNote(note, 'upsert');

        expect(vi.mocked(addConflicts)).toHaveBeenCalledTimes(1);
        const surfaced = vi.mocked(addConflicts).mock.calls[0]?.[0]?.[0];
        expect(surfaced).toMatchObject({ entityName: 'Solenne Minoris' });
        // never silently overwrites
        expect(post).not.toHaveBeenCalled();
        expect(patch).not.toHaveBeenCalled();
        expect(del).not.toHaveBeenCalled();
    });

    it('ignores Notes on Scenes that are not bound to a Kanka map', async () => {
        const scene = makeScene({}); // no kankaMapId flag
        const note = makeNote(scene);

        await reconcileSceneNote(note, 'upsert');

        expect(post).not.toHaveBeenCalled();
        expect(vi.mocked(api.getMapMarkers)).not.toHaveBeenCalled();
    });

    it('does nothing for a non-GM user', async () => {
        vi.stubGlobal('game', { user: { isGM: false }, settings: { get: (): string => '42' }, journal: { get: (): undefined => undefined } });
        const scene = makeScene();
        const note = makeNote(scene);

        await reconcileSceneNote(note, 'upsert');

        expect(post).not.toHaveBeenCalled();
    });
});

describe('registerSceneSyncBackHooks', () => {
    it('registers the Note and Scene change hooks', () => {
        registerSceneSyncBackHooks();
        const hookNames = vi.mocked(Hooks.on).mock.calls.map((call) => call[0]);
        expect(hookNames).toEqual(expect.arrayContaining(['createNote', 'updateNote', 'deleteNote', 'updateScene']));
    });
});
