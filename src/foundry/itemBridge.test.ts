import { describe, expect, it } from 'vitest';
import type { KankaApiAttribute, KankaApiEntityId, KankaApiId, KankaApiItem } from '../types/kanka';
import type { PlainObject } from '../util/reflection';
import { applyVariantOverrides, buildWorldItemData, getItemAttribute, parseVariantOverrides, setByPath } from './itemBridge';

function attr(name: string, value: string | null): KankaApiAttribute {
    return {
        id: 1,
        type: 'text',
        name,
        value,
        parsed: null,
        is_star: false,
        default_order: 0,
        is_private: false,
    };
}

function createItem(data: Partial<KankaApiItem> = {}): KankaApiItem {
    return {
        id: 7,
        entity_id: 700,
        name: 'Laspistol',
        entry: '',
        entry_parsed: '',
        urls: { view: '', api: '' },
        attributes: [],
        posts: [],
        entity_assets: [],
        is_private: false,
        created_at: '',
        created_by: 0,
        updated_at: '2024-01-01T00:00:00Z',
        updated_by: 0,
        parents: [],
        children: [],
        relations: [],
        inventory: [],
        entity_abilities: [],
        reminders: [],
        type: null,
        price: null,
        size: null,
        weight: null,
        ...data,
    };
}

describe('getItemAttribute', () => {
    it('returns the value of the named attribute', () => {
        const attrs = [attr('foundry_uuid', 'Compendium.x.Item.abc'), attr('other', 'nope')];
        expect(getItemAttribute(attrs, 'foundry_uuid')).toBe('Compendium.x.Item.abc');
    });

    it('returns undefined for a missing attribute', () => {
        expect(getItemAttribute([], 'foundry_uuid')).toBeUndefined();
    });

    it('treats null and empty values as undefined', () => {
        expect(getItemAttribute([attr('foundry_uuid', null)], 'foundry_uuid')).toBeUndefined();
        expect(getItemAttribute([attr('foundry_uuid', '')], 'foundry_uuid')).toBeUndefined();
    });
});

describe('parseVariantOverrides', () => {
    it('parses a JSON object', () => {
        expect(parseVariantOverrides('{"clip":1,"a.b":2}')).toEqual({ 'clip': 1, 'a.b': 2 });
    });

    it('returns an empty object for undefined input', () => {
        expect(parseVariantOverrides(undefined)).toEqual({});
    });

    it('returns an empty object for invalid JSON without throwing', () => {
        expect(parseVariantOverrides('{not json')).toEqual({});
    });

    it('returns an empty object for non-object JSON (array / scalar)', () => {
        expect(parseVariantOverrides('[1,2,3]')).toEqual({});
        expect(parseVariantOverrides('42')).toEqual({});
        expect(parseVariantOverrides('null')).toEqual({});
    });
});

describe('setByPath', () => {
    it('sets a top-level key', () => {
        const target: PlainObject = {};
        setByPath(target, 'clip', 1);
        expect(target).toEqual({ clip: 1 });
    });

    it('sets a nested dot-path, creating intermediate objects', () => {
        const target: PlainObject = {};
        setByPath(target, 'clip.value', 30);
        expect(target).toEqual({ clip: { value: 30 } });
    });

    it('overwrites a non-object intermediate with an object', () => {
        const target: PlainObject = { clip: 5 };
        setByPath(target, 'clip.value', 30);
        expect(target).toEqual({ clip: { value: 30 } });
    });

    it('preserves sibling keys when descending', () => {
        const target: PlainObject = { clip: { max: 40 } };
        setByPath(target, 'clip.value', 30);
        expect(target).toEqual({ clip: { max: 40, value: 30 } });
    });

    it('ignores an empty path', () => {
        const target: PlainObject = { a: 1 };
        setByPath(target, '', 5);
        expect(target).toEqual({ a: 1 });
    });
});

describe('applyVariantOverrides', () => {
    it('applies all dot-path overrides onto the system object', () => {
        const system: PlainObject = { clip: { value: 1, max: 30 }, range: 30 };
        applyVariantOverrides(system, { 'clip.value': 30, 'range': 50, 'reliable': true });
        expect(system).toEqual({ clip: { value: 30, max: 30 }, range: 50, reliable: true });
    });

    it('is a no-op for an empty override map', () => {
        const system: PlainObject = { a: 1 };
        applyVariantOverrides(system, {});
        expect(system).toEqual({ a: 1 });
    });
});

describe('buildWorldItemData', () => {
    const clone = {
        name: 'Las Pistol (template)',
        type: 'weapon',
        img: 'icons/weapon.png',
        system: { clip: { value: 1, max: 30 }, range: 30 },
    };

    function freshClone(): typeof clone {
        return { ...clone, system: { clip: { value: 1, max: 30 }, range: 30 } };
    }

    it('sets the name from the Kanka entity', () => {
        const entity = createItem({ name: 'Solenne Pattern Laspistol' });
        const data = buildWorldItemData(freshClone(), entity, 'Compendium.x.Item.abc', {}, 4711, 'folder-1');
        expect(data['name']).toBe('Solenne Pattern Laspistol');
    });

    it('applies variant overrides into system', () => {
        const entity = createItem();
        const data = buildWorldItemData(freshClone(), entity, 'Compendium.x.Item.abc', { 'clip.value': 30 }, 4711, 'folder-1');
        const system = data['system'];
        expect(system).toEqual({ clip: { value: 30, max: 30 }, range: 30 });
    });

    it('stamps _stats.compendiumSource with the compendium UUID', () => {
        const entity = createItem();
        const data = buildWorldItemData(freshClone(), entity, 'Compendium.x.Item.abc', {}, 4711, 'folder-1');
        const stats = data['_stats'];
        expect(stats).toMatchObject({ compendiumSource: 'Compendium.x.Item.abc' });
    });

    it('stamps the kanka-foundry flags for idempotency and write-back', () => {
        const entity = createItem({ id: 7 as KankaApiId, entity_id: 700 as KankaApiEntityId });
        const data = buildWorldItemData(freshClone(), entity, 'Compendium.x.Item.abc', {}, 4711, 'folder-1');
        const flags = data['flags'];
        expect(flags).toMatchObject({
            'kanka-foundry': {
                entityId: 7,
                kankaEntityId: 700,
                campaign: 4711,
                compendiumSource: 'Compendium.x.Item.abc',
                version: '2024-01-01T00:00:00Z',
            },
        });
    });

    it('sets the folder id', () => {
        const entity = createItem();
        const data = buildWorldItemData(freshClone(), entity, 'Compendium.x.Item.abc', {}, 4711, 'folder-1');
        expect(data['folder']).toBe('folder-1');
    });
});
