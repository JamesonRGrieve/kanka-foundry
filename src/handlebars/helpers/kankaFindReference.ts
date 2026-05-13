import type Reference from '../../types/Reference';
import type { KankaApiAnyId, KankaApiModuleType } from '../../types/kanka';
import resolveReference from '../../util/resolveReference';
import kankaIsAccessible from './kankaIsAccessible';

interface HbsSystemData {
    references?: Record<string, Reference>;
}

interface HbsPageData {
    system?: HbsSystemData;
}

interface HbsRootContext {
    data?: HbsPageData;
}

interface HbsRootData {
    root?: HbsRootContext;
}

function isHbsRootData(value: unknown): value is HbsRootData {
    return value !== null && typeof value === 'object';
}

function isRefMap(value: unknown): value is Record<string, Reference> {
    return value !== null && typeof value === 'object';
}

export default function kankaFindReference(
    id: KankaApiAnyId | undefined,
    typeParam: KankaApiModuleType | Handlebars.HelperOptions | undefined,
    optionsParam: Handlebars.HelperOptions | undefined,
): Reference | undefined {
    if (!id) return undefined;

    let type: KankaApiModuleType | undefined;
    let options: Handlebars.HelperOptions | undefined;

    if (typeof typeParam === 'object') {
        options = typeParam;
        type = undefined;
    } else {
        type = typeParam;
        options = optionsParam;
    }

    const optionsRaw: unknown = options;
    const rawData: unknown = optionsRaw !== null && typeof optionsRaw === 'object' ? Reflect.get(optionsRaw, 'data') : undefined;
    const rootData = isHbsRootData(rawData) ? rawData : undefined;
    const fromRoot = rootData?.root?.data?.system?.references;
    const rawFromHash: unknown = options?.hash?.['references'];
    const fromHash: Record<string, Reference> | undefined = isRefMap(rawFromHash) ? rawFromHash : undefined;
    const refMap: Record<string, Reference> = fromRoot ?? fromHash ?? {};

    const ref = resolveReference(id, type, refMap);

    if (ref && options && kankaIsAccessible(ref, options)) {
        return ref;
    }

    return undefined;
}
