import api from '../api';
import type { KankaApiId } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
import { CHARACTERISTIC_REVERSE_MAP, STAT_REVERSE_MAP } from './actorFactory';

/**
 * Extract mechanical stats from a Foundry Actor and create Kanka attributes.
 */
async function pushActorToKanka(actor: Actor): Promise<void> {
    if (!api.isReady) {
        ui.notifications?.error('Kanka-Foundry: API not ready. Check your access token.');
        return;
    }

    const campaignId = game.settings?.get('kanka-foundry', 'campaign') as string;
    if (!campaignId) {
        ui.notifications?.error('Kanka-Foundry: No campaign selected.');
        return;
    }

    const numericCampaignId = Number(campaignId) as KankaApiId;

    try {
        // Create character in Kanka
        const system = actor.system as Record<string, unknown>;
        const bio = system.bio as Record<string, string> | undefined;

        const characterData: Record<string, unknown> = {
            name: actor.name,
            type: (actor.type as string) === 'character' ? 'Acolyte' : 'NPC',
        };

        if (bio) {
            if (bio.gender) characterData.sex = bio.gender;
            if (bio.age) characterData.age = bio.age;
            if (bio.notes) characterData.entry = bio.notes;
        }

        const kankaCharacter = await api.createCharacter(numericCampaignId, characterData);
        logInfo(`Created Kanka character "${actor.name}" with id ${String(kankaCharacter.id)}`);

        // Create attributes for mechanical stats
        const characteristics = system.characteristics as Record<string, Record<string, unknown>> | undefined;
        if (characteristics) {
            for (const [foundryKey, charData] of Object.entries(characteristics)) {
                const kankaName = CHARACTERISTIC_REVERSE_MAP[foundryKey];
                if (kankaName && charData?.base !== undefined && Number(charData.base) > 0) {
                    await api.createEntityAttribute(
                        numericCampaignId,
                        kankaCharacter.entity_id,
                        { name: kankaName, value: String(charData.base) },
                    );
                }
            }
        }

        // Create stat attributes
        for (const [foundryPath, kankaName] of Object.entries(STAT_REVERSE_MAP)) {
            const parts = foundryPath.split('.');
            let value: unknown = system;
            for (const part of parts) {
                if (value && typeof value === 'object') {
                    value = (value as Record<string, unknown>)[part];
                } else {
                    value = undefined;
                    break;
                }
            }
            if (value !== undefined && Number(value) > 0) {
                await api.createEntityAttribute(
                    numericCampaignId,
                    kankaCharacter.entity_id,
                    { name: kankaName, value: String(value) },
                );
            }
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
                onclick: () => pushActorToKanka(actor),
            });
        } else {
            buttons.unshift({
                label: 'Open in Kanka',
                class: 'kanka-open',
                icon: 'fas fa-external-link-alt',
                onclick: () => {
                    const snapshot = actor.getFlag('kanka-foundry', 'snapshot') as Record<string, unknown> | undefined;
                    const urls = snapshot?.urls as { view?: string } | undefined;
                    if (urls?.view) {
                        window.open(urls.view, '_blank');
                    }
                },
            });
        }
    });
}
