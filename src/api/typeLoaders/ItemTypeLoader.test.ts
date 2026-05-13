import { describe, expect, it, vi } from 'vitest';
import api from '..';
import type { KankaApiItem, KankaApiEntity, KankaApiEntityId, KankaApiId, KankaApiModuleType } from '../../types/kanka';
import ItemTypeLoader from './ItemTypeLoader';
import { stubAbilityLink, stubInventory, stubRelation } from './test-helpers';

vi.mock('../../api/KankaApi');

function createItem(data: Partial<KankaApiItem> = {}): KankaApiItem {
    return {
        id: 0,
        entity_id: 0,
        name: 'Test Item',
        entry: '',
        entry_parsed: '',
        urls: { view: '', api: '' },
        attributes: [],
        posts: [],
        entity_assets: [],
        is_private: false,
        created_at: '',
        created_by: 0,
        updated_at: '',
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

function createEntity(entityId: KankaApiEntityId, childId: KankaApiId, type: KankaApiModuleType): KankaApiEntity {
    return {
        module: {
            code: type,
            id: 1,
            singular: type,
            plural: type,
        },
        type: 'Some type',
        id: entityId,
        child_id: childId,
        name: 'Foobar',
        updated_at: '',
        created_at: '',
        is_private: false,
        campaign_id: 4711,
        created_by: 1,
        updated_by: 1,
        is_template: false,
        child: {
            has_custom_image: false,
        },
        urls: {
            view: 'http://app.kanka.com/w/4711/entities/1234',
            api: 'http://api.kanka.com/campaign/4711/items/1234',
        },
    };
}

describe('ItemTypeLoader', () => {
    describe('getType()', () => {
        it('returns the correct type', () => {
            const loader = new ItemTypeLoader();

            expect(loader.getType()).toEqual('item');
        });
    });

    describe('load()', () => {
        it('returns result of getItem', async () => {
            const expectedResult = createItem();
            const loader = new ItemTypeLoader();
            vi.mocked(api).getItem.mockResolvedValue(expectedResult);

            const result = await loader.load(4711, 12);

            expect(api.getItem).toHaveBeenCalledWith(4711, 12);
            expect(result).toMatchObject(expectedResult);
        });

        it('normalizes character_id to creator_id', async () => {
            const expectedResult = createItem({ character_id: 42 });
            const loader = new ItemTypeLoader();
            vi.mocked(api).getItem.mockResolvedValue(expectedResult);

            const result = await loader.load(4711, 12);

            expect(result.creator_id).toBe(42);
        });
    });

    describe('loadAll()', () => {
        it('returns result of getAllItems', async () => {
            const expectedResult = [createItem()];
            const loader = new ItemTypeLoader();
            vi.mocked(api).getAllItems.mockResolvedValue(expectedResult);

            const result = await loader.loadAll(4711);

            expect(api.getAllItems).toHaveBeenCalledWith(4711);
            expect(result).toMatchObject(expectedResult);
        });

        it('normalizes character_id to creator_id for all items', async () => {
            const expectedResult = [createItem({ character_id: 42 }), createItem({ character_id: 99 })];
            const loader = new ItemTypeLoader();
            vi.mocked(api).getAllItems.mockResolvedValue(expectedResult);

            const result = await loader.loadAll(4711);
            const [first, second] = result;
            expect(first).toBeDefined();
            expect(second).toBeDefined();
            expect(first?.creator_id).toBe(42);
            expect(second?.creator_id).toBe(99);
        });
    });

    describe('createReferenceCollection()', () => {
        it('includes relations from the lookup array', async () => {
            const expectedResult = createItem({
                relations: [stubRelation(1002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'character'), createEntity(1003, 2003, 'quest')];

            const loader = new ItemTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'character',
                },
            });
        });

        it('includes inventory from the lookup array', async () => {
            const expectedResult = createItem({
                inventory: [stubInventory(2002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'item'), createEntity(1003, 2003, 'quest')];

            const loader = new ItemTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'item',
                },
            });
        });

        it('includes entity_abilities from the lookup array', async () => {
            const expectedResult = createItem({
                entity_abilities: [stubAbilityLink(2002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'ability'), createEntity(1003, 2003, 'quest')];

            const loader = new ItemTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'ability',
                },
            });
        });

        it('includes location from the lookup array', async () => {
            const expectedResult = createItem({
                location_id: 2002,
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'location'), createEntity(1003, 2003, 'quest')];

            const loader = new ItemTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'location',
                },
            });
        });

        it('includes creator from the lookup array', async () => {
            const expectedResult = createItem({
                creator_id: 2002,
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'character'), createEntity(1003, 2003, 'quest')];

            const loader = new ItemTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'character',
                },
            });
        });

        it('includes parents from the lookup array', async () => {
            const expectedResult = createItem({
                parents: [2002],
            });

            const entities = [createEntity(1001, 2001, 'item'), createEntity(1002, 2002, 'item'), createEntity(1003, 2003, 'quest')];

            const loader = new ItemTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'item',
                },
            });
        });

        it('includes children from the lookup array', async () => {
            const expectedResult = createItem({
                children: [2002],
            });

            const entities = [createEntity(1001, 2001, 'item'), createEntity(1002, 2002, 'item'), createEntity(1003, 2003, 'quest')];

            const loader = new ItemTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'item',
                },
            });
        });
    });
});
