import { describe, expect, it, vi } from 'vitest';
import api from '..';
import type { KankaApiEntity, KankaApiEntityId, KankaApiId, KankaApiModuleType, KankaApiQuest } from '../../types/kanka';
import QuestTypeLoader from './QuestTypeLoader';
import { stubAbilityLink, stubInventory, stubQuestElement, stubRelation } from './test-helpers';

vi.mock('../../api/KankaApi');

function createQuest(data: Partial<KankaApiQuest> = {}): KankaApiQuest {
    return {
        id: 0,
        entity_id: 0,
        name: 'Test Quest',
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
        date: null,
        location_id: null,
        is_completed: false,
        elements_count: 0,
        elements: [],
        calendar_id: null,
        calendar_year: null,
        calendar_month: null,
        calendar_day: null,
        calendar_reminder_length: null,
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
            api: 'http://api.kanka.com/campaign/4711/quests/1234',
        },
    };
}

describe('QuestTypeLoader', () => {
    describe('getType()', () => {
        it('returns the correct type', () => {
            const loader = new QuestTypeLoader();

            expect(loader.getType()).toEqual('quest');
        });
    });

    describe('load()', () => {
        it('returns result of getQuest', async () => {
            const expectedResult = createQuest();
            const loader = new QuestTypeLoader();
            vi.mocked(api).getQuest.mockResolvedValue(expectedResult);

            const result = await loader.load(4711, 12);

            expect(api.getQuest).toHaveBeenCalledWith(4711, 12);
            expect(result).toBe(expectedResult);
        });
    });

    describe('loadAll()', () => {
        it('returns result of getAllQuests', async () => {
            const expectedResult = [createQuest()];
            const loader = new QuestTypeLoader();
            vi.mocked(api).getAllQuests.mockResolvedValue(expectedResult);

            const result = await loader.loadAll(4711);

            expect(api.getAllQuests).toHaveBeenCalledWith(4711);
            expect(result).toBe(expectedResult);
        });
    });

    describe('createReferenceCollection()', () => {
        it('includes relations from the lookup array', async () => {
            const expectedResult = createQuest({
                relations: [stubRelation(1002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'character'), createEntity(1003, 2003, 'quest')];

            const loader = new QuestTypeLoader();
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
            const expectedResult = createQuest({
                inventory: [stubInventory(2002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'item'), createEntity(1003, 2003, 'quest')];

            const loader = new QuestTypeLoader();
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
            const expectedResult = createQuest({
                entity_abilities: [stubAbilityLink(2002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'ability'), createEntity(1003, 2003, 'quest')];

            const loader = new QuestTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'ability',
                },
            });
        });

        it('includes parents from the lookup array', async () => {
            const expectedResult = createQuest({
                parents: [2002],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'quest'), createEntity(1003, 2003, 'quest')];

            const loader = new QuestTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'quest',
                },
            });
        });

        it('includes children from the lookup array', async () => {
            const expectedResult = createQuest({
                children: [2002],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'quest'), createEntity(1003, 2003, 'quest')];

            const loader = new QuestTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'quest',
                },
            });
        });

        it('includes location from the lookup array', async () => {
            const expectedResult = createQuest({
                location_id: 2001,
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'character'), createEntity(1003, 2003, 'quest')];

            const loader = new QuestTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1001: {
                    id: 2001,
                    entityId: 1001,
                    type: 'location',
                },
            });
        });

        it('includes insticator from the lookup array', async () => {
            const expectedResult = createQuest({
                instigator_id: 1002,
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'character'), createEntity(1003, 2003, 'quest')];

            const loader = new QuestTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'character',
                },
            });
        });

        it('includes quest elements from the lookup array', async () => {
            const expectedResult = createQuest({
                elements: [stubQuestElement(1002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'character'), createEntity(1003, 2003, 'quest')];

            const loader = new QuestTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'character',
                },
            });
        });
    });
});
