import loaders from './api/typeLoaders';
import type AbstractTypeLoader from './api/typeLoaders/AbstractTypeLoader';
import { createOrUpdateActor } from './foundry/actorFactory';
import { bridgeKankaItem } from './foundry/itemBridge';
import { createJournalEntry, updateJournalEntry } from './foundry/journalEntries';
import { showWarning } from './foundry/notifications';
import { importVehicle, isVehicleEntity } from './foundry/vehicleImport';
import type { KankaApiCharacter, KankaApiChildEntity, KankaApiEntity, KankaApiId, KankaApiItem, KankaApiModuleType } from './types/kanka';
import { logError } from './util/logger';

function assertType<T>(_value: unknown): asserts _value is T {}

async function handleEntity(loader: AbstractTypeLoader, entity: KankaApiChildEntity, campaignId: KankaApiId, entityLookup?: KankaApiEntity[]) {
    const references = await loader.createReferenceCollection(campaignId, entity, entityLookup);
    await createJournalEntry(campaignId, loader.getType(), entity, references);

    // Create/update Foundry Actor for character entities
    if (loader.getType() === 'character') {
        const createActors = game.settings?.get('kanka-foundry', 'createActorsForCharacters') ?? true;
        if (createActors) {
            const { defaultType, gameSystem, pcTags } = resolveActorImportSettings();
            const entityTags = resolveEntityTags(entity, entityLookup);
            assertType<KankaApiCharacter>(entity);
            await createOrUpdateActor(entity, entityTags, campaignId, defaultType, pcTags, gameSystem);
        }
    }

    // A vehicle is a Kanka Location carrying a `base_actor` attribute: emit its
    // Actor AND — when it has an interior image map — a linked walkable-interior
    // Scene. No-op for a non-vehicle Location. GM-triggered (this path runs only
    // on explicit import).
    if (loader.getType() === 'location' && isVehicleEntity(entity)) {
        const { defaultType, gameSystem, pcTags } = resolveActorImportSettings();
        const entityTags = resolveEntityTags(entity, entityLookup);
        await importVehicle(entity, entityTags, campaignId, defaultType, pcTags, gameSystem);
    }

    // Bridge bridgeable Kanka items to world Items cloned from a compendium.
    // Runs alongside the journal-entry creation; a non-bridgeable item is a no-op.
    if (loader.getType() === 'item') {
        assertType<KankaApiItem>(entity);
        await bridgeKankaItem(entity, campaignId);
    }
}

/** Resolve the Foundry-actor import settings (default type, game system, PC tags) once. */
function resolveActorImportSettings(): { defaultType: string; gameSystem: string; pcTags: string[] } {
    const defaultTypeRaw: unknown = game.settings?.get('kanka-foundry', 'defaultActorType');
    const gameSystemRaw: unknown = game.settings?.get('kanka-foundry', 'defaultGameSystem');
    const pcTagsRaw: unknown = game.settings?.get('kanka-foundry', 'pcTags');
    const pcTagsSetting = typeof pcTagsRaw === 'string' ? pcTagsRaw : 'pc,acolyte';
    return {
        defaultType: typeof defaultTypeRaw === 'string' ? defaultTypeRaw : 'npc',
        gameSystem: typeof gameSystemRaw === 'string' ? gameSystemRaw : 'dh2',
        pcTags: pcTagsSetting
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean),
    };
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

    // A single entity whose Kanka API read fails (e.g. a corrupt entity_asset
    // making `?related=1` return HTTP 500) must never abort the whole sync.
    // Isolate each entity: log and record the failure, keep going, then warn once.
    const failedIds: number[] = [];

    // Check whether fetching all entities of the type would be more efficient than fetching them individually
    if (ids.length > expectedNumberRequests) {
        const loader = loaders.get(type);
        if (!loader) throw new Error(`Missing loader for type ${String(type)}`);

        const entities = await loader.loadAll(campaignId);
        entities.filter((entity) => ids.includes(entity.id));

        for (const entity of entities) {
            // Make sure to handle them in sequence to avoid duplicate folders being created
            try {
                await handleEntity(loader, entity, campaignId, entityLookup);
            } catch (error) {
                logError('Kanka: skipped', type, 'entity', entity.id, 'during sync', error);
                failedIds.push(Number(entity.id));
            }
        }
    } else {
        for (const id of ids) {
            // Make sure to handle them in sequence to avoid duplicate folders being created
            try {
                await createEntity(campaignId, type, id, entityLookup);
            } catch (error) {
                logError('Kanka: skipped', type, 'entity', id, 'during sync', error);
                failedIds.push(Number(id));
            }
        }
    }

    if (failedIds.length > 0) {
        showWarning('browser.error.skippedEntities', { count: String(failedIds.length), ids: failedIds.join(', ') });
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
            const { defaultType, gameSystem, pcTags } = resolveActorImportSettings();
            const entityTags = resolveEntityTags(entity, entityLookup);
            assertType<KankaApiCharacter>(entity);
            await createOrUpdateActor(entity, entityTags, campaignId, defaultType, pcTags, gameSystem);
        }
    }

    // Re-run the vehicle emit on update (idempotent: the Actor + interior Scene
    // are updated in place, never duplicated). No-op for a non-vehicle Location.
    if (type === 'location' && isVehicleEntity(entity)) {
        const { defaultType, gameSystem, pcTags } = resolveActorImportSettings();
        const entityTags = resolveEntityTags(entity, entityLookup);
        await importVehicle(entity, entityTags, campaignId, defaultType, pcTags, gameSystem);
    }

    if (type === 'item') {
        assertType<KankaApiItem>(entity);
        assertType<KankaApiId>(campaignId);
        await bridgeKankaItem(entity, campaignId);
    }
}
