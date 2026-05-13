import { showInfo } from '../foundry/notifications';
import { logInfo } from '../util/logger';

function assertType<T>(_value: unknown): asserts _value is T {}

interface StoreSetting {
    key: string;
    value: string;
}

function getSettingValue(key: string): string | undefined {
    const storageRaw: unknown = game.settings?.storage.get('world');
    assertType<Iterable<unknown> | null | undefined>(storageRaw);
    for (const item of storageRaw ?? []) {
        if (item !== null && typeof item === 'object' && 'key' in item) {
            assertType<StoreSetting>(item);
            if (item.key === key) return item.value;
        }
    }
    return undefined;
}

// Migrate to new Kanka-URL if the new one is available
export default async function migrate(): Promise<void> {
    const baseUrl = getSettingValue('kanka-foundry.baseUrl') ?? 'https://kanka.io';

    logInfo('Check for v2 migration...', { baseUrl });

    // Only run this migration if the user has no custom Kanka url or if the manually set URL is the official Kanka url.
    if (!game.user?.isGM || !/^https:\/\/kanka.io/.test(baseUrl)) {
        return;
    }

    logInfo('Update the baseUrl config...');
    await game.settings?.set('kanka-foundry', 'baseUrl', 'https://api.kanka.io');
    showInfo('migration.migrated-v2');

    logInfo('V2 migration done!');
}
