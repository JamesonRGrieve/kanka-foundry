import type { AnyConstrainable } from '../../types/kanka';
import isSecret from '../../util/isSecret';

interface HbsRootData {
    owner?: boolean;
}

interface HbsData {
    root?: HbsRootData;
}

function isHbsData(value: unknown): value is HbsData {
    return value !== null && typeof value === 'object';
}

export default function kankaIsAccessible(entity: AnyConstrainable, options: Handlebars.HelperOptions): boolean {
    const optionsRaw: unknown = options;
    const rawData: unknown = optionsRaw !== null && typeof optionsRaw === 'object' ? Reflect.get(optionsRaw, 'data') : undefined;
    const data = isHbsData(rawData) ? rawData : undefined;
    if (data?.root?.owner) {
        return true;
    }

    return !isSecret(entity);
}
