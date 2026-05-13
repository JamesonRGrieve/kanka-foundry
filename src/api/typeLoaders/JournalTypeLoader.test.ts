import { describe, expect, it, vi } from 'vitest';
import api from '..';
import type { KankaApiJournal, KankaApiEntity, KankaApiEntityId, KankaApiId, KankaApiModuleType } from '../../types/kanka';
import JournalTypeLoader from './JournalTypeLoader';
import { stubAbilityLink, stubInventory, stubRelation } from './test-helpers';

vi.mock('../../api/KankaApi');

function createJournal(data: Partial<KankaApiJournal> = {}): KankaApiJournal {
    return {
        id: 0,
        entity_id: 0,
        name: 'Test Journal',
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
            api: 'http://api.kanka.com/campaign/4711/journals/1234',
        },
    };
}

describe('JournalTypeLoader', () => {
    describe('getType()', () => {
        it('returns the correct type', () => {
            const loader = new JournalTypeLoader();

            expect(loader.getType()).toEqual('journal');
        });
    });

    describe('load()', () => {
        it('returns result of getJournal', async () => {
            const expectedResult = createJournal();
            const loader = new JournalTypeLoader();
            vi.mocked(api).getJournal.mockResolvedValue(expectedResult);

            const result = await loader.load(4711, 12);

            expect(api.getJournal).toHaveBeenCalledWith(4711, 12);
            expect(result).toMatchObject(expectedResult);
        });

        it('normalizes character_id to author_id', async () => {
            const expectedResult = createJournal({ character_id: 42 });
            const loader = new JournalTypeLoader();
            vi.mocked(api).getJournal.mockResolvedValue(expectedResult);

            const result = await loader.load(4711, 12);

            expect(result.author_id).toBe(42);
        });
    });

    describe('loadAll()', () => {
        it('returns result of getAllJournals', async () => {
            const expectedResult = [createJournal()];
            const loader = new JournalTypeLoader();
            vi.mocked(api).getAllJournals.mockResolvedValue(expectedResult);

            const result = await loader.loadAll(4711);

            expect(api.getAllJournals).toHaveBeenCalledWith(4711);
            expect(result).toMatchObject(expectedResult);
        });

        it('normalizes character_id to author_id for all journals', async () => {
            const expectedResult = [createJournal({ character_id: 42 }), createJournal({ character_id: 99 })];
            const loader = new JournalTypeLoader();
            vi.mocked(api).getAllJournals.mockResolvedValue(expectedResult);

            const result = await loader.loadAll(4711);
            const [first, second] = result;
            expect(first).toBeDefined();
            expect(second).toBeDefined();
            expect(first?.author_id).toBe(42);
            expect(second?.author_id).toBe(99);
        });
    });

    describe('createReferenceCollection()', () => {
        it('includes relations from the lookup array', async () => {
            const expectedResult = createJournal({
                relations: [stubRelation(1002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'character'), createEntity(1003, 2003, 'quest')];

            const loader = new JournalTypeLoader();
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
            const expectedResult = createJournal({
                inventory: [stubInventory(2002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'item'), createEntity(1003, 2003, 'quest')];

            const loader = new JournalTypeLoader();
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
            const expectedResult = createJournal({
                entity_abilities: [stubAbilityLink(2002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'ability'), createEntity(1003, 2003, 'quest')];

            const loader = new JournalTypeLoader();
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
            const expectedResult = createJournal({
                parents: [2002],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'journal'), createEntity(1003, 2003, 'quest')];

            const loader = new JournalTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'journal',
                },
            });
        });

        it('includes children from the lookup array', async () => {
            const expectedResult = createJournal({
                children: [2002],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'journal'), createEntity(1003, 2003, 'quest')];

            const loader = new JournalTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'journal',
                },
            });
        });

        it('includes location from the lookup array', async () => {
            const expectedResult = createJournal({
                location_id: 2002,
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'location'), createEntity(1003, 2003, 'quest')];

            const loader = new JournalTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'location',
                },
            });
        });

        it('includes author from the lookup array', async () => {
            const expectedResult = createJournal({
                author_id: 2002,
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'character'), createEntity(1003, 2003, 'quest')];

            const loader = new JournalTypeLoader();
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
