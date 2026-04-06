import type { KankaApiEntity, KankaApiId, KankaApiLocation, KankaApiModuleType } from '../../types/kanka';
import api from '..';
import type ReferenceCollection from '../ReferenceCollection';
import AbstractTypeLoader from './AbstractTypeLoader';

export default class LocationTypeLoader extends AbstractTypeLoader<KankaApiLocation> {
    public getType(): KankaApiModuleType {
        return 'location';
    }

    public async createReferenceCollection(
        campaignId: KankaApiId,
        entity: KankaApiLocation,
        lookup: KankaApiEntity[] = [],
    ): Promise<ReferenceCollection> {
        return super.createReferenceCollection(campaignId, entity, lookup);
    }

    public async load(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiLocation> {
        return api.getLocation(campaignId, id);
    }

    public async loadAll(campaignId: KankaApiId): Promise<KankaApiLocation[]> {
        return api.getAllLocations(campaignId);
    }
}
