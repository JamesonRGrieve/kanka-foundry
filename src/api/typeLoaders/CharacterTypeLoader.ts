import api from '..';
import type { KankaApiCharacter, KankaApiEntity, KankaApiId, KankaApiModuleType } from '../../types/kanka';
import type ReferenceCollection from '../ReferenceCollection';
import AbstractTypeLoader from './AbstractTypeLoader';

export default class CharacterTypeLoader extends AbstractTypeLoader<KankaApiCharacter> {
    public getType(): KankaApiModuleType {
        return 'character';
    }

    public override async createReferenceCollection(
        campaignId: KankaApiId,
        entity: KankaApiCharacter,
        lookup: KankaApiEntity[] = [],
    ): Promise<ReferenceCollection> {
        const collection = await super.createReferenceCollection(campaignId, entity, lookup);

        await Promise.all([
            ...(entity.locations ?? []).map(async (id) => collection.addById(id, 'location')),
            ...(entity.races ?? []).map(async (id) => collection.addById(id, 'race')),
            ...(entity.families ?? []).map(async (id) => collection.addById(id, 'family')),
            ...entity.organisations.data.map(async (org) => collection.addById(org.organisation_id, 'organisation')),
        ]);

        return collection;
    }

    private normalize(entity: KankaApiCharacter): KankaApiCharacter {
        return {
            ...entity,
            races: entity.races ?? (entity.race_id ? [entity.race_id] : []),
            families: entity.families ?? (entity.family_id ? [entity.family_id] : []),
            locations: entity.locations ?? (entity.location_id ? [entity.location_id] : []),
        };
    }

    public async load(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiCharacter> {
        return this.normalize(await api.getCharacter(campaignId, id));
    }

    public async loadAll(campaignId: KankaApiId): Promise<KankaApiCharacter[]> {
        return (await api.getAllCharacters(campaignId)).map((e) => this.normalize(e));
    }
}
