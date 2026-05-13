import type { KankaApiChildEntity, KankaApiChildEntityWithChildren, KankaApiEntity, KankaApiId, KankaApiModuleType } from '../../types/kanka';
import ReferenceCollection from '../ReferenceCollection';
import { hasChildren } from '../../util/kankaTypeGuards';

export default abstract class AbstractTypeLoader<T extends KankaApiChildEntity = KankaApiChildEntity> {
    public async createReferenceCollection(campaignId: KankaApiId, entity: T, lookup?: KankaApiEntity[]): Promise<ReferenceCollection> {
        const collection = new ReferenceCollection(campaignId, lookup);
        const withChildren: KankaApiChildEntityWithChildren | undefined = hasChildren(entity) ? entity : undefined;
        const parents = withChildren?.parents ?? [];
        const children = withChildren?.children ?? [];

        await Promise.all([
            ...parents.map(async (parent) => collection.addById(parent, this.getType())),
            ...children.map(async (child) => collection.addById(child, this.getType())),
            ...entity.relations.map(async (relation) => collection.addByEntityId(relation.target_id)),
            ...entity.inventory.map(async (item) => collection.addById(item.item_id, 'item')),
            ...entity.entity_abilities.map(async (ability) => collection.addById(ability.ability_id, 'ability')),
            ...entity.reminders.map(async (reminder) => collection.addById(reminder.calendar_id, 'calendar')),
        ]);

        return collection;
    }

    public abstract getType(): KankaApiModuleType;
    public abstract load(campaignId: KankaApiId, id: KankaApiId): Promise<T>;
    public abstract loadAll(campaignId: KankaApiId): Promise<T[]>;
}
