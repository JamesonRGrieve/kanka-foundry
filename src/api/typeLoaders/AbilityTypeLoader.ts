import type { KankaApiAbility, KankaApiEntity, KankaApiId, KankaApiModuleType } from '../../types/kanka';
import api from '..';
import type ReferenceCollection from '../ReferenceCollection';
import AbstractTypeLoader from './AbstractTypeLoader';

export default class AbilityTypeLoader extends AbstractTypeLoader<KankaApiAbility> {
    public getType(): KankaApiModuleType {
        return 'ability';
    }

    public async createReferenceCollection(
        campaignId: KankaApiId,
        entity: KankaApiAbility,
        lookup: KankaApiEntity[] = [],
    ): Promise<ReferenceCollection> {
        return super.createReferenceCollection(campaignId, entity, lookup);
    }

    public async load(campaignId: KankaApiId, id: KankaApiId): Promise<KankaApiAbility> {
        return api.getAbility(campaignId, id);
    }

    public async loadAll(campaignId: KankaApiId): Promise<KankaApiAbility[]> {
        return api.getAllAbilities(campaignId);
    }
}
