import api from '..';
import type { KankaApiCreature, KankaApiEntity, KankaApiId, KankaApiModuleType } from '../../types/kanka';
import type ReferenceCollection from '../ReferenceCollection';
import AbstractTypeLoader from './AbstractTypeLoader';

export default class CreatureTypeLoader extends AbstractTypeLoader<KankaApiCreature> {
    public getType(): KankaApiModuleType {
        return 'creature';
    }

    public override async createReferenceCollection(
        campaignId: KankaApiId,
        entity: KankaApiCreature,
        lookup: KankaApiEntity[] = [],
    ): Promise<ReferenceCollection> {
        const collection = await super.createReferenceCollection(campaignId, entity, lookup);

        await Promise.all([...entity.locations.map(async (location) => collection.addById(location, 'location'))]);

        return collection;
    }

    public async load(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiCreature> {
        return api.getCreature(campaignId, id);
    }

    public async loadAll(campaignId: KankaApiId): Promise<KankaApiCreature[]> {
        return api.getAllCreatures(campaignId);
    }
}
