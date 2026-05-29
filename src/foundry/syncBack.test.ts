import { describe, expect, it, vi } from 'vitest';
import { buildItemWriteBackPayload, selectJournalUpdate } from './syncBack';

vi.mock('../api');

describe('buildItemWriteBackPayload', () => {
    it('maps name, type, description, price and weight', () => {
        const payload = buildItemWriteBackPayload({
            name: 'Laspistol',
            type: 'weapon',
            system: { description: 'A reliable sidearm.', price: 50, weight: 1.5 },
        });
        expect(payload).toEqual({
            name: 'Laspistol',
            type: 'weapon',
            entry: 'A reliable sidearm.',
            price: '50',
            weight: '1.5',
        });
    });

    it('omits absent / empty narrative fields', () => {
        const payload = buildItemWriteBackPayload({ name: 'Bare', system: {} });
        expect(payload).toEqual({ name: 'Bare' });
    });

    it('omits an empty name and empty type', () => {
        expect(buildItemWriteBackPayload({ name: '', type: '' })).toEqual({});
    });

    it('stringifies a string price as-is', () => {
        const payload = buildItemWriteBackPayload({ system: { price: '12 thrones' } });
        expect(payload['price']).toBe('12 thrones');
    });

    it('reads weight from a nested { value } object', () => {
        const payload = buildItemWriteBackPayload({ system: { weight: { value: 3, units: 'kg' } } });
        expect(payload['weight']).toBe('3');
    });

    it('never emits mechanical stats such as damage or penetration', () => {
        const payload = buildItemWriteBackPayload({
            name: 'Bolt Pistol',
            type: 'weapon',
            system: { damage: '1d10+5', penetration: 4, range: 30, description: 'Sacred bolt rounds.' },
        });
        expect(payload).toEqual({ name: 'Bolt Pistol', type: 'weapon', entry: 'Sacred bolt rounds.' });
        expect(payload).not.toHaveProperty('damage');
        expect(payload).not.toHaveProperty('penetration');
        expect(payload).not.toHaveProperty('range');
    });
});

describe('selectJournalUpdate', () => {
    it('dispatches character journals to the character endpoint', () => {
        expect(selectJournalUpdate('character')).toBe('character');
    });

    it('dispatches item journals to the item endpoint', () => {
        expect(selectJournalUpdate('item')).toBe('item');
    });

    it('dispatches quest journals to the quest endpoint', () => {
        expect(selectJournalUpdate('quest')).toBe('quest');
    });

    it('returns null for types without a dedicated update method', () => {
        expect(selectJournalUpdate('note')).toBeNull();
        expect(selectJournalUpdate('location')).toBeNull();
        expect(selectJournalUpdate('organisation')).toBeNull();
        expect(selectJournalUpdate(undefined)).toBeNull();
    });
});
