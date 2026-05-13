import moduleConfig from '../../public/module.json';
import type Reference from '../types/Reference';
import type { KankaApiModuleType } from '../types/kanka';
import getMessage from './getMessage';

const MAX_FOLDER_DEPTH = 3;

function getFolderFlag(entry: Folder | undefined, name: string): unknown {
    if (!entry) return undefined;

    const flags: unknown = entry.flags;
    if (flags === null || typeof flags !== 'object') return undefined;
    const kankaFlags: unknown = Reflect.get(flags, 'kanka-foundry');
    if (kankaFlags === null || typeof kankaFlags !== 'object') return undefined;
    return Reflect.get(kankaFlags, name);
}

async function createFolder(name: string, parent: Folder | undefined, flags: Record<string, unknown> = {}): Promise<Folder | undefined> {
    const data: Record<`flags.${string}.${string}`, unknown> = {};

    for (const [flag, value] of Object.entries(flags)) {
        data[`flags.${moduleConfig.name}.${flag}`] = value;
    }

    return Folder.create({
        name,
        folder: parent?.id ?? null,
        type: 'JournalEntry',
        ...data,
    });
}

function findFolderByFlags(flags: Record<string, unknown>): Folder | undefined {
    const entries = Object.entries(flags);

    if (entries.length === 0) return undefined;

    return game.folders?.find((folder) => {
        if (folder.type !== 'JournalEntry') return false;
        return entries.every(([flag, value]) => getFolderFlag(folder, flag) === value);
    });
}

async function ensureFolderByFlags(name: string, parent: Folder | undefined, flags: Record<string, unknown>): Promise<Folder | undefined> {
    const folder = findFolderByFlags(flags);

    if (folder) return folder;

    return createFolder(name, parent, flags);
}

async function ensureTypeFolder(type: KankaApiModuleType): Promise<Folder | undefined> {
    return ensureFolderByFlags(`[KANKA] ${getMessage('entityType', type)}`, undefined, {
        type,
    });
}

export async function ensureFolderPath(type: KankaApiModuleType, path: Reference[]): Promise<Folder | undefined> {
    let parent = await ensureTypeFolder(type);

    if (!game.settings?.get('kanka-foundry', 'keepTreeStructure')) return parent;

    for (let i = 0; i < Math.min(path.length, MAX_FOLDER_DEPTH - 1); i += 1) {
        const entry = path[i];
        if (!entry) continue;
        const { name, entityId } = entry;
        parent = await ensureFolderByFlags(name, parent, { entityId });
    }

    return parent;
}
