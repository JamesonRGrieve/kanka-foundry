import { describe, expect, it, vi } from 'vitest';
import api from '..';
import type { KankaApiNote, KankaApiEntity, KankaApiEntityId, KankaApiId, KankaApiModuleType } from '../../types/kanka';
import NoteTypeLoader from './NoteTypeLoader';
import { stubAbilityLink, stubInventory, stubRelation } from './test-helpers';

vi.mock('../../api/KankaApi');

function createNote(data: Partial<KankaApiNote> = {}): KankaApiNote {
    return {
        id: 0,
        entity_id: 0,
        name: 'Test Note',
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
            api: 'http://api.kanka.com/campaign/4711/notes/1234',
        },
    };
}

describe('NoteTypeLoader', () => {
    describe('getType()', () => {
        it('returns the correct type', () => {
            const loader = new NoteTypeLoader();

            expect(loader.getType()).toEqual('note');
        });
    });

    describe('load()', () => {
        it('returns result of getNote', async () => {
            const expectedResult = createNote();
            const loader = new NoteTypeLoader();
            vi.mocked(api).getNote.mockResolvedValue(expectedResult);

            const result = await loader.load(4711, 12);

            expect(api.getNote).toHaveBeenCalledWith(4711, 12);
            expect(result).toBe(expectedResult);
        });
    });

    describe('loadAll()', () => {
        it('returns result of getAllNotes', async () => {
            const expectedResult = [createNote()];
            const loader = new NoteTypeLoader();
            vi.mocked(api).getAllNotes.mockResolvedValue(expectedResult);

            const result = await loader.loadAll(4711);

            expect(api.getAllNotes).toHaveBeenCalledWith(4711);
            expect(result).toBe(expectedResult);
        });
    });

    describe('createReferenceCollection()', () => {
        it('includes relations from the lookup array', async () => {
            const expectedResult = createNote({
                relations: [stubRelation(1002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'character'), createEntity(1003, 2003, 'quest')];

            const loader = new NoteTypeLoader();
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
            const expectedResult = createNote({
                inventory: [stubInventory(2002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'item'), createEntity(1003, 2003, 'quest')];

            const loader = new NoteTypeLoader();
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
            const expectedResult = createNote({
                entity_abilities: [stubAbilityLink(2002)],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'ability'), createEntity(1003, 2003, 'quest')];

            const loader = new NoteTypeLoader();
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
            const expectedResult = createNote({
                parents: [2002],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'note'), createEntity(1003, 2003, 'quest')];

            const loader = new NoteTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'note',
                },
            });
        });

        it('includes children from the lookup array', async () => {
            const expectedResult = createNote({
                children: [2002],
            });

            const entities = [createEntity(1001, 2001, 'location'), createEntity(1002, 2002, 'note'), createEntity(1003, 2003, 'quest')];

            const loader = new NoteTypeLoader();
            const collection = await loader.createReferenceCollection(4711, expectedResult, entities);

            expect(collection.getRecord()).toMatchObject({
                1002: {
                    id: 2002,
                    entityId: 1002,
                    type: 'note',
                },
            });
        });
    });
});
