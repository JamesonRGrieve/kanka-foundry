export default async function migrate(): Promise<void> {
    const permissionSetting = await game.settings?.get('kanka-foundry', 'automaticPermissions');

    // Don't run the migration if the setting is already a valid value
    if (permissionSetting && ['never', 'initial', 'always'].includes(permissionSetting)) {
        return;
    }

    if (String(permissionSetting) === 'false') {
        await game.settings?.set('kanka-foundry', 'automaticPermissions', 'never');
    } else if (String(permissionSetting) === 'true') {
        await game.settings?.set('kanka-foundry', 'automaticPermissions', 'initial');
    } else {
        await game.settings?.set('kanka-foundry', 'automaticPermissions', 'never');
    }
}
