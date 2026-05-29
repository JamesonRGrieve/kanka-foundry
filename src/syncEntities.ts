import loaders from './api/typeLoaders';
import type AbstractTypeLoader from './api/typeLoaders/AbstractTypeLoader';
import { createOrUpdateActor } from './foundry/actorFactory';
import { bridgeKankaItem } from './foundry/itemBridge';
import { createJournalEntry, updateJournalEntry } from './foundry/journalEntries';
import type { KankaApiCharacter, KankaApiChildEntity, KankaApiEntity, KankaApiId, KankaApiItem, KankaApiModuleType } from './types/kanka';

function assertType<T>(_value: unknown): asserts _value is T {}

async function handleEntity(loader: AbstractTypeLoader, entity: KankaApiChildEntity, campaignId: KankaApiId, entityLookup?: KankaApiEntity[]) {
    const references = await loader.createReferenceCollection(campaignId, entity, entityLookup);
    await createJournalEntry(campaignId, loader.getType(), entity, references);

    // Create/update Foundry Actor for character entities
    if (loader.getType() === 'character') {
        const createActors = game.settings?.get('kanka-foundry', 'createActorsForCharacters') ?? true;
        if (createActors) {
            const defaultTypeRaw: unknown = game.settings?.get('kanka-foundry', 'defaultActorType');
            const defaultType = typeof defaultTypeRaw === 'string' ? defaultTypeRaw : 'npc';
            const gameSystemRaw: unknown = game.settings?.get('kanka-foundry', 'defaultGameSystem');
            const gameSystem = typeof gameSystemRaw === 'string' ? gameSystemRaw : 'dh2';
            const pcTagsRaw: unknown = game.settings?.get('kanka-foundry', 'pcTags');
            const pcTagsSetting = typeof pcTagsRaw === 'string' ? pcTagsRaw : 'pc,acolyte';
            const pcTags = pcTagsSetting
                .split(',')
                .map((t: string) => t.trim())
                .filter(Boolean);

            // Resolve tag IDs to names from entity lookup
            const entityTags = resolveEntityTags(entity, entityLookup);

            assertType<KankaApiCharacter>(entity);
            await createOrUpdateActor(entity, entityTags, campaignId, defaultType, pcTags, gameSystem);
        }
    }

    // Bridge bridgeable Kanka items to world Items cloned from a compendium.
    // Runs alongside the journal-entry creation; a non-bridgeable item is a no-op.
    if (loader.getType() === 'item') {
        assertType<KankaApiItem>(entity);
        await bridgeKankaItem(entity, campaignId);
    }
}

function resolveEntityTags(entity: KankaApiChildEntity, entityLookup?: KankaApiEntity[]): string[] {
    // Tags on the character entity are tag IDs. Try to resolve names from lookup.
    const rawTags: unknown = Reflect.get(entity, 'tags');
    if (!Array.isArray(rawTags)) return [];
    const tags: unknown[] = Array.from(rawTags as unknown[]);

    // If we have entity lookup, try to find tag entities
    if (entityLookup) {
        return tags
            .map((tagIdRaw: unknown) => {
                const tagId = Number(tagIdRaw);
                const tagEntity = entityLookup.find((e) => e.module.code === 'tag' && Number(e.child_id) === tagId);
                return tagEntity?.name;
            })
            .filter((name): name is string => !!name);
    }

    // Fallback: return stringified IDs (won't match tag names, but avoids errors)
    return [];
}

export async function createEntity(campaignId: KankaApiId, type: KankaApiModuleType, id: KankaApiId, entityLookup?: KankaApiEntity[]): Promise<void> {
    const loader = loaders.get(type);
    if (!loader) throw new Error(`Missing loader for type ${String(type)}`);
    const entity = await loader.load(campaignId, id);

    await handleEntity(loader, entity, campaignId, entityLookup);
}

export async function createEntities(campaignId: KankaApiId, type: KankaApiModuleType, ids: KankaApiId[], entityLookup?: KankaApiEntity[]): Promise<void> {
    const numberOfEntities = entityLookup?.filter((entity) => entity.module.code === type).length ?? 0;
    const expectedNumberRequests = Math.ceil(numberOfEntities / 45);

    // Check whether fetching all entities of the type would be more efficient than fetching them individually
    if (ids.length > expectedNumberRequests) {
        const loader = loaders.get(type);
        if (!loader) throw new Error(`Missing loader for type ${String(type)}`);

        const entities = await loader.loadAll(campaignId);
        entities.filter((entity) => ids.includes(entity.id));

        for (const entity of entities) {
            // Make sure to handle them in sequence to avoid duplicate folders being created
            await handleEntity(loader, entity, campaignId, entityLookup);
        }
    } else {
        for (const id of ids) {
            // Make sure to handle them in sequence to avoid duplicate folders being created
            await createEntity(campaignId, type, id, entityLookup);
        }
    }
}

export async function updateEntity(entry: JournalEntry, entityLookup?: KankaApiEntity[]): Promise<void> {
    const type = entry.getFlag('kanka-foundry', 'type');
    const campaignId = entry.getFlag('kanka-foundry', 'campaign');
    const snapshot = entry.getFlag('kanka-foundry', 'snapshot');

    if (!type || !campaignId || !snapshot) throw new Error('Missing flags on journal entry');

    const loader = loaders.get(type);
    if (!loader) throw new Error(`Missing loader for type ${String(type)}`);
    const entity = await loader.load(campaignId, snapshot.id);

    const references = await loader.createReferenceCollection(campaignId, entity, entityLookup);
    await updateJournalEntry(entry, entity, references);

    // Also update the Actor if it exists
    if (type === 'character') {
        const createActors = game.settings?.get('kanka-foundry', 'createActorsForCharacters') ?? true;
        if (createActors) {
            const defaultTypeRaw2: unknown = game.settings?.get('kanka-foundry', 'defaultActorType');
            const defaultType2 = typeof defaultTypeRaw2 === 'string' ? defaultTypeRaw2 : 'npc';
            const gameSystemRaw2: unknown = game.settings?.get('kanka-foundry', 'defaultGameSystem');
            const gameSystem2 = typeof gameSystemRaw2 === 'string' ? gameSystemRaw2 : 'dh2';
            const pcTagsRaw2: unknown = game.settings?.get('kanka-foundry', 'pcTags');
            const pcTagsSetting2 = typeof pcTagsRaw2 === 'string' ? pcTagsRaw2 : 'pc,acolyte';
            const pcTags2 = pcTagsSetting2
                .split(',')
                .map((t: string) => t.trim())
                .filter(Boolean);
            const entityTags = resolveEntityTags(entity, entityLookup);

            assertType<KankaApiCharacter>(entity);
            await createOrUpdateActor(entity, entityTags, campaignId, defaultType2, pcTags2, gameSystem2);
        }
    }

    if (type === 'item') {
        assertType<KankaApiItem>(entity);
        assertType<KankaApiId>(campaignId);
        await bridgeKankaItem(entity, campaignId);
    }
}
