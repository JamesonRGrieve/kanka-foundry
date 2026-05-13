import type Reference from '../types/Reference';
import { type KankaApiSimpleConstrainable, type KankaApiVisibilityConstrainable, KankaVisibility } from '../types/kanka';

function hasVisibility(entity: unknown): entity is KankaApiVisibilityConstrainable {
    return typeof entity === 'object' && entity !== null && 'visibility_id' in entity;
}

function hasIsPrivate(entity: unknown): entity is KankaApiSimpleConstrainable {
    return typeof entity === 'object' && entity !== null && 'is_private' in entity;
}

function isReference(entity: unknown): entity is Reference {
    return typeof entity === 'object' && entity !== null && 'isPrivate' in entity;
}

export default function isSecret(...entities: unknown[]): boolean {
    return entities.some((entity) => {
        if (hasVisibility(entity)) {
            return ![KankaVisibility.all, KankaVisibility.members].includes(entity.visibility_id);
        }

        if (hasIsPrivate(entity)) {
            return entity.is_private;
        }

        if (isReference(entity)) {
            return entity.isPrivate;
        }

        return false;
    });
}
