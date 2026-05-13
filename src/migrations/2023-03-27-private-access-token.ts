interface StoreSetting {
    key: string;
    value: string;
    delete(): Promise<void>;
}

function assertType<T>(_value: unknown): asserts _value is T {}

function getStoreSetting(key: string): StoreSetting | undefined {
    const storageRaw: unknown = game.settings?.storage.get('world');
    assertType<Iterable<unknown> | null | undefined>(storageRaw);
    for (const item of storageRaw ?? []) {
        if (item !== null && typeof item === 'object' && 'key' in item) {
            assertType<StoreSetting>(item);
            if (item.key === key) return item;
        }
    }
    return undefined;
}

// Migrate global Kanka access key setting to local setting
export default async function migrate(): Promise<void> {
    const accessKeySetting = getStoreSetting('kanka-foundry.accessToken');
    const accessKey: string | undefined = accessKeySetting?.value;

    if (game.user?.isGM && accessKey) {
        await game.settings?.set('kanka-foundry', 'accessToken', accessKey);
        await accessKeySetting?.delete();

        const campaignSetting = getStoreSetting('kanka-foundry.campaign');
        await game.settings?.set('kanka-foundry', 'campaign', campaignSetting?.value ?? '');
    }
}
