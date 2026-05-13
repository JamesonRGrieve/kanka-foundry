import type Reference from '../../types/Reference';
import type { KankaApiAnyId, KankaApiModuleType } from '../../types/kanka';
import kankaFindReference from './kankaFindReference';
import kankaIsAccessible from './kankaIsAccessible';

export default function kankaFilterReferences(
    array?: Reference[],
    idProperty?: string,
    type?: KankaApiModuleType,
    options?: Handlebars.HelperOptions,
): unknown[] {
    if (!options) return array ?? [];

    return (
        array?.filter((entity) => {
            if (!kankaIsAccessible(entity, options)) return false;
            if (!idProperty) return true;

            const rawId: unknown = idProperty === 'this' ? entity : foundry.utils.getProperty(entity, idProperty);
            const id: KankaApiAnyId | undefined = typeof rawId === 'number' ? rawId : undefined;
            if (options.hash?.['optionalReference'] && !id) return true;

            const reference = kankaFindReference(id, type, options);
            if (!reference) return false;

            return kankaIsAccessible(reference, options);
        }) ?? []
    );
}
