import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addConflicts, listConflicts, removeConflict, setConflicts } from './conflictStore';
import { type StoredConflict, conflictId } from './types';

function makeConflict(overrides: Partial<StoredConflict> = {}): StoredConflict {
    return {
        id: conflictId('actor', 'a1', 'WS'),
        kind: 'characteristic',
        entityType: 'actor',
        entityId: 'a1',
        entityName: 'Dalvor',
        label: 'WS',
        kankaAttr: 'WS',
        foundryPath: 'characteristics.weaponSkill.base',
        kankaValue: '35',
        foundryValue: '40',
        ...overrides,
    };
}

let store: Record<string, string>;

beforeEach(() => {
    store = {};
    vi.stubGlobal('game', {
        settings: {
            get: (_namespace: string, key: string): string => store[key] ?? '',
            set: (_namespace: string, key: string, value: string): void => {
                store[key] = value;
            },
        },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('conflictStore', () => {
    it('returns an empty list when nothing is stored', () => {
        expect(listConflicts()).toEqual([]);
    });

    it('persists and reads back added conflicts', async () => {
        const conflict = makeConflict();
        await addConflicts([conflict]);
        expect(listConflicts()).toEqual([conflict]);
    });

    it('upserts by id instead of duplicating, refreshing the stored values', async () => {
        await addConflicts([makeConflict({ foundryValue: '40' })]);
        await addConflicts([makeConflict({ foundryValue: '55' })]);

        const stored = listConflicts();
        expect(stored).toHaveLength(1);
        expect(stored[0]?.foundryValue).toBe('55');
    });

    it('keeps distinct ids side by side', async () => {
        await addConflicts([makeConflict(), makeConflict({ id: conflictId('actor', 'a1', 'BS'), label: 'BS', kankaAttr: 'BS' })]);
        expect(listConflicts()).toHaveLength(2);
    });

    it('removes a single conflict by id', async () => {
        await addConflicts([makeConflict(), makeConflict({ id: conflictId('actor', 'a2', 'WS'), entityId: 'a2' })]);
        await removeConflict(conflictId('actor', 'a1', 'WS'));

        const stored = listConflicts();
        expect(stored).toHaveLength(1);
        expect(stored[0]?.entityId).toBe('a2');
    });

    it('replaces the whole registry with setConflicts', async () => {
        await addConflicts([makeConflict()]);
        await setConflicts([]);
        expect(listConflicts()).toEqual([]);
    });

    it('tolerates corrupt JSON by returning an empty list', () => {
        store['pendingConflicts'] = '{not valid json';
        expect(listConflicts()).toEqual([]);
    });

    it('drops malformed entries while keeping valid ones', () => {
        store['pendingConflicts'] = JSON.stringify([makeConflict(), { id: 'broken' }]);
        expect(listConflicts()).toHaveLength(1);
    });
});
