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

// Migrate from old journal entry format to new page based format
export default async function migrate(): Promise<void> {
    const baseUrl = getSettingValue('kanka-foundry.baseUrl');
    const isKankaUrl = /^https?:\/\/(api|www|app\.)?kanka?\.io/.test(baseUrl ?? '');

    if (game.user?.isGM && isKankaUrl) {
        await game.settings?.set('kanka-foundry', 'baseUrl', '');
    }
}
