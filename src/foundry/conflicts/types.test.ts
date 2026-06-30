import { describe, expect, it } from 'vitest';
import { type StoredConflict, conflictId, isNumericKind, isStoredConflict } from './types';

function makeConflict(overrides: Partial<StoredConflict> = {}): StoredConflict {
    return {
        id: 'actor:abc:WS',
        kind: 'characteristic',
        entityType: 'actor',
        entityId: 'abc',
        entityName: 'Dalvor',
        label: 'WS',
        kankaAttr: 'WS',
        foundryPath: 'characteristics.weaponSkill.base',
        kankaValue: '35',
        foundryValue: '40',
        ...overrides,
    };
}

describe('conflictId', () => {
    it('builds a stable colon-joined id from its coordinates', () => {
        expect(conflictId('actor', 'abc', 'WS')).toBe('actor:abc:WS');
        expect(conflictId('campaign', '44342', 'entry')).toBe('campaign:44342:entry');
    });
});

describe('isNumericKind', () => {
    it('is true only for characteristic and stat kinds', () => {
        expect(isNumericKind('characteristic')).toBe(true);
        expect(isNumericKind('stat')).toBe(true);
        expect(isNumericKind('bio')).toBe(false);
        expect(isNumericKind('snapshot')).toBe(false);
        expect(isNumericKind('campaignDescription')).toBe(false);
    });
});

describe('isStoredConflict', () => {
    it('accepts a fully-formed conflict', () => {
        expect(isStoredConflict(makeConflict())).toBe(true);
    });

    it('rejects non-objects', () => {
        expect(isStoredConflict(null)).toBe(false);
        expect(isStoredConflict('x')).toBe(false);
        expect(isStoredConflict(undefined)).toBe(false);
        expect(isStoredConflict([])).toBe(false);
    });

    it('rejects an unknown kind or entityType', () => {
        expect(isStoredConflict({ ...makeConflict(), kind: 'bogus' })).toBe(false);
        expect(isStoredConflict({ ...makeConflict(), entityType: 'item' })).toBe(false);
    });

    it('rejects when a required string field is missing or mistyped', () => {
        const { kankaValue: _omit, ...withoutValue } = makeConflict();
        expect(isStoredConflict(withoutValue)).toBe(false);
        expect(isStoredConflict({ ...makeConflict(), entityId: 42 })).toBe(false);
    });
});
