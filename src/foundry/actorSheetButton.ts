import api from '../api';
import type { KankaApiId } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
import { BIO_MAP, CHARACTERISTIC_REVERSE_MAP, ORIGIN_MAP, ROOT_STRING_MAP, STAT_REVERSE_MAP } from './actorAttributeMaps';
function assertType<T>(_value: unknown): asserts _value is T {}

function getSystemProp<T>(system: unknown, key: string): T | undefined {
    if (system === null || typeof system !== 'object') return undefined;
    const val: unknown = Reflect.get(system, key);
    assertType<T>(val);
    return val;
}

/**
 * Extract mechanical stats from a Foundry Actor and create Kanka attributes.
 */
async function pushActorToKanka(actor: Actor): Promise<void> {
    if (!api.isReady) {
        ui.notifications?.error('Kanka-Foundry: API not ready. Check your access token.');
        return;
    }

    const campaignIdRaw: unknown = game.settings?.get('kanka-foundry', 'campaign');
    const campaignId = typeof campaignIdRaw === 'string' ? campaignIdRaw : String(campaignIdRaw ?? '');
    if (!campaignId) {
        ui.notifications?.error('Kanka-Foundry: No campaign selected.');
        return;
    }

    const numericCampaignId: KankaApiId = Number(campaignId);

    try {
        // Create character in Kanka
        const system: unknown = actor.system;
        const bio = getSystemProp<Record<string, string>>(system, 'bio');

        const characterData: Record<string, unknown> = {
            name: actor.name,
            // wh40k-rpg actor types are <system>-<kind>; the kind suffix
            // distinguishes PC vs NPC. Legacy bare 'character' was migrated
            // away by 2026-05-11-system-prefix-actor-types, so we only need
            // to inspect the suffix here.
            type: (actor.type as string).endsWith('-character') ? 'Acolyte' : 'NPC',
        };

        if (bio) {
            if (bio['gender']) characterData['sex'] = bio['gender'];
            if (bio['age']) characterData['age'] = bio['age'];
            if (bio['notes']) characterData['entry'] = bio['notes'];
        }

        const kankaCharacter = await api.createCharacter(numericCampaignId, characterData);
        logInfo(`Created Kanka character "${actor.name}" with id ${String(kankaCharacter.id)}`);

        const createAttributeIfPresent = async (name: string, value: unknown): Promise<void> => {
            if (value === undefined || value === null || value === '') return;

            await api.createEntityAttribute(numericCampaignId, kankaCharacter.entity_id, { name, value: String(value) });
        };

        // Create attributes for mechanical stats
        const characteristics = getSystemProp<Record<string, Record<string, unknown>>>(system, 'characteristics');
        if (characteristics) {
            for (const [foundryKey, charData] of Object.entries(characteristics)) {
                const kankaName = CHARACTERISTIC_REVERSE_MAP[foundryKey];
                if (kankaName && charData?.['base'] !== undefined && Number(charData['base']) > 0) {
                    await api.createEntityAttribute(numericCampaignId, kankaCharacter.entity_id, { name: kankaName, value: String(charData['base']) });
                }
            }
        }

        // Create stat attributes
        for (const [foundryPath, kankaName] of Object.entries(STAT_REVERSE_MAP)) {
            const parts = foundryPath.split('.');
            let value: unknown = system;
            for (const part of parts) {
                if (value && typeof value === 'object') {
                    value = Reflect.get(value, part);
                } else {
                    value = undefined;
                    break;
                }
            }
            if (value !== undefined && Number(value) > 0) {
                await api.createEntityAttribute(numericCampaignId, kankaCharacter.entity_id, { name: kankaName, value: String(value) });
            }
        }

        for (const [foundryKey, kankaName] of Object.entries(BIO_MAP)) {
            await createAttributeIfPresent(kankaName, bio?.[foundryKey]);
        }

        const originPath = getSystemProp<Record<string, unknown>>(system, 'originPath');
        for (const [foundryKey, kankaName] of Object.entries(ORIGIN_MAP)) {
            await createAttributeIfPresent(kankaName, originPath?.[foundryKey]);
        }

        for (const [foundryKey, kankaName] of Object.entries(ROOT_STRING_MAP)) {
            const val: unknown = system !== null && typeof system === 'object' ? Reflect.get(system, foundryKey) : undefined;
            await createAttributeIfPresent(kankaName, val);
        }

        // Set kanka-foundry flags on the Actor
        await actor.setFlag('kanka-foundry', 'kankaEntityId', kankaCharacter.entity_id);
        await actor.setFlag('kanka-foundry', 'kankaChildId', kankaCharacter.id);
        await actor.setFlag('kanka-foundry', 'campaign', numericCampaignId);
        await actor.setFlag('kanka-foundry', 'snapshot', kankaCharacter);
        await actor.setFlag('kanka-foundry', 'version', kankaCharacter.updated_at);

        ui.notifications?.info(`Pushed "${actor.name}" to Kanka successfully.`);
    } catch (error) {
        logError('Failed to push Actor to Kanka', error);
        ui.notifications?.error('Kanka-Foundry: Failed to push Actor to Kanka. Check the console for details.');
    }
}

export function registerActorSheetButtons(): void {
    Hooks.on('getActorSheetHeaderButtons', (sheet: ActorSheet, buttons: Application.HeaderButton[]) => {
        const actor = sheet.actor;
        if (!actor) return;

        const hasKankaFlag = actor.getFlag('kanka-foundry', 'kankaEntityId');

        if (!hasKankaFlag) {
            buttons.unshift({
                label: 'Push to Kanka',
                class: 'kanka-push',
                icon: 'fas fa-upload',
                onclick: async () => pushActorToKanka(actor),
            });
        } else {
            buttons.unshift({
                label: 'Open in Kanka',
                class: 'kanka-open',
                icon: 'fas fa-external-link-alt',
                onclick: () => {
                    const snapshotRaw: unknown = actor.getFlag('kanka-foundry', 'snapshot');
                    if (snapshotRaw === null || typeof snapshotRaw !== 'object') return;
                    assertType<Record<string, unknown>>(snapshotRaw);
                    const urlsRaw: unknown = snapshotRaw['urls'];
                    if (urlsRaw === null || typeof urlsRaw !== 'object') return;
                    assertType<{ view?: string }>(urlsRaw);
                    if (urlsRaw.view) {
                        window.open(urlsRaw.view, '_blank');
                    }
                },
            });
        }
    });
}
