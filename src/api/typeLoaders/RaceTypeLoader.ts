import api from '..';
import type { KankaApiEntity, KankaApiId, KankaApiModuleType, KankaApiRace } from '../../types/kanka';
import type ReferenceCollection from '../ReferenceCollection';
import AbstractTypeLoader from './AbstractTypeLoader';

export default class RaceTypeLoader extends AbstractTypeLoader<KankaApiRace> {
    public getType(): KankaApiModuleType {
        return 'race';
    }

    public override async createReferenceCollection(campaignId: KankaApiId, entity: KankaApiRace, lookup: KankaApiEntity[] = []): Promise<ReferenceCollection> {
        const collection = await super.createReferenceCollection(campaignId, entity, lookup);

        await Promise.all([...entity.locations.map(async (location) => collection.addById(location, 'location'))]);

        return collection;
    }

    public async load(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiRace> {
        return api.getRace(campaignId, id);
    }

    public async loadAll(campaignId: KankaApiId): Promise<KankaApiRace[]> {
        return api.getAllRaces(campaignId);
    }
}
