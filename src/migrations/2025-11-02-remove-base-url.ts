// Migrate from old journal entry format to new page based format
export default async function migrate(): Promise<void> {
    const baseUrlSetting = game.settings?.storage
        .get('world')
        ?.find((setting) => setting.key === 'kanka-foundry.baseUrl');
    const baseUrl = baseUrlSetting?.value;
    const isKankaUrl = /^https?:\/\/(api|www|app\.)?kanka?\.io/.test(baseUrl);

    if (game.user?.isGM && isKankaUrl) {
        await game.settings?.set('kanka-foundry', 'baseUrl', '');
    }
}
