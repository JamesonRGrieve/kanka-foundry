import localization from '../../state/localization';

interface HbsHash {
    [key: string]: string;
}

interface HbsOptions {
    hash?: HbsHash;
}

function isHbsOptions(value: unknown): value is HbsOptions {
    return value !== null && typeof value === 'object';
}

function isHbsHash(value: unknown): value is HbsHash {
    return value !== null && typeof value === 'object';
}

export default function kankaLocalize(...args: unknown[]): string {
    const rawOptions = args[args.length - 1];
    const hash: HbsHash = isHbsOptions(rawOptions) && isHbsHash(rawOptions.hash) ? rawOptions.hash : {};

    const parts = args.slice(0, -1).map((part) => {
        if (part === null || part === undefined) return 'notAvailable';
        if (typeof part === 'boolean') return part ? 'yes' : 'no';
        return String(part);
    });

    const key = ['KANKA', ...parts].join('.');

    return foundry.utils.isEmpty(hash) ? localization.localize(key) : localization.format(String(key), hash);
}
