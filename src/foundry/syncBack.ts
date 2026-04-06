import api from '../api';
import type { KankaApiAttribute, KankaApiEntityId, KankaApiId } from '../types/kanka';
import { logError, logInfo } from '../util/logger';
import {
    CHARACTERISTIC_REVERSE_MAP,
    STAT_REVERSE_MAP,
} from './actorFactory';

const DEBOUNCE_MS = 5000;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Extracts kanka-mapped field changes from a Foundry Actor update diff.
 * Returns a map of Kanka attribute names to their new values.
 */
function extractKankaChanges(changes: Record<string, unknown>): Map<string, string> {
    const kankaUpdates = new Map<string, string>();
    const system = changes.system as Record<string, unknown> | undefined;
    if (!system) return kankaUpdates;

    // Check characteristics
    const chars = system.characteristics as Record<string, Record<string, unknown>> | undefined;
    if (chars) {
        for (const [foundryKey, charData] of Object.entries(chars)) {
            if (charData?.base !== undefined) {
                const kankaName = CHARACTERISTIC_REVERSE_MAP[foundryKey];
                if (kankaName) {
                    kankaUpdates.set(kankaName, String(charData.base));
                }
            }
        }
    }

    // Check stat fields
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
        if (value !== undefined) {
            kankaUpdates.set(kankaName, String(value));
        }
    }

    return kankaUpdates;
}

/**
 * Push attribute changes back to Kanka for a single entity.
 */
async function pushAttributesToKanka(
    campaignId: KankaApiId,
    entityId: KankaApiEntityId,
    updates: Map<string, string>,
): Promise<void> {
    // Get existing attributes
    let existingAttributes: KankaApiAttribute[];
    try {
        existingAttributes = await api.getEntityAttributes(campaignId, entityId);
    } catch (error) {
        logError('Failed to fetch entity attributes from Kanka', error);
        return;
    }

    for (const [name, value] of updates) {
        const existing = existingAttributes.find((a) => a.name === name);
        try {
            if (existing) {
                await api.updateEntityAttribute(campaignId, entityId, existing.id, { value });
            } else {
                await api.createEntityAttribute(campaignId, entityId, { name, value });
            }
        } catch (error) {
            logError(`Failed to sync attribute "${name}" to Kanka`, error);
        }
    }

    logInfo(`Synced ${updates.size} attribute(s) to Kanka entity ${String(entityId)}`);
}

/**
 * Push narrative changes (name, entry) back to Kanka.
 */
async function pushCharacterToKanka(
    campaignId: KankaApiId,
    childId: KankaApiId,
    actor: Actor,
): Promise<void> {
    const data: Record<string, unknown> = {};
    const snapshot = actor.getFlag('kanka-foundry', 'snapshot') as Record<string, unknown> | undefined;

    // Only push name if it changed from snapshot
    if (snapshot && actor.name !== snapshot.name) {
        data.name = actor.name;
    }

    if (Object.keys(data).length > 0) {
        try {
            await api.updateCharacter(campaignId, childId, data);
            logInfo(`Synced character data to Kanka character ${String(childId)}`);
        } catch (error) {
            logError('Failed to sync character data to Kanka', error);
        }
    }
}

function handleActorUpdate(actor: Actor, changes: Record<string, unknown>): void {
    if (!api.isReady) return;
    if (!game.user?.isGM) return;
    if (!(game.settings?.get('kanka-foundry', 'syncBackActors') ?? false)) return;

    const kankaEntityId = actor.getFlag('kanka-foundry', 'kankaEntityId') as KankaApiEntityId | undefined;
    const kankaChildId = actor.getFlag('kanka-foundry', 'kankaChildId') as KankaApiId | undefined;
    const campaignId = actor.getFlag('kanka-foundry', 'campaign') as KankaApiId | undefined;

    if (!kankaEntityId || !kankaChildId || !campaignId) return;

    const kankaChanges = extractKankaChanges(changes);
    const hasNameChange = changes.name !== undefined;

    if (kankaChanges.size === 0 && !hasNameChange) return;

    // Debounce: clear any pending timer for this entity
    const key = String(kankaEntityId);
    const existingTimer = pendingTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(async () => {
        pendingTimers.delete(key);

        if (kankaChanges.size > 0) {
            await pushAttributesToKanka(campaignId, kankaEntityId, kankaChanges);
        }
        if (hasNameChange) {
            await pushCharacterToKanka(campaignId, kankaChildId, actor);
        }

        // Update the snapshot version
        try {
            await actor.setFlag('kanka-foundry', 'version', new Date().toISOString());
        } catch {
            // Non-critical
        }
    }, DEBOUNCE_MS);

    pendingTimers.set(key, timer);
}

function handleJournalUpdate(entry: JournalEntry, changes: Record<string, unknown>): void {
    if (!api.isReady) return;
    if (!game.user?.isGM) return;
    if (!(game.settings?.get('kanka-foundry', 'syncBackJournals') ?? false)) return;

    const kankaEntityId = entry.getFlag('kanka-foundry', 'id');
    const campaignId = entry.getFlag('kanka-foundry', 'campaign');
    const type = entry.getFlag('kanka-foundry', 'type');
    const snapshot = entry.getFlag('kanka-foundry', 'snapshot') as Record<string, unknown> | undefined;

    if (!kankaEntityId || !campaignId || !type || !snapshot) return;

    // Only handle name changes for now
    if (changes.name === undefined) return;

    const childId = snapshot.id as KankaApiId;

    const key = `journal-${String(kankaEntityId)}`;
    const existingTimer = pendingTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(async () => {
        pendingTimers.delete(key);
        try {
            await api.updateCharacter(campaignId as KankaApiId, childId, { name: changes.name });
            logInfo(`Synced journal name change to Kanka`);
        } catch (error) {
            logError('Failed to sync journal changes to Kanka', error);
        }
    }, DEBOUNCE_MS);

    pendingTimers.set(key, timer);
}

export function registerSyncBackHooks(): void {
    Hooks.on('updateActor', (actor: Actor, changes: Record<string, unknown>) => {
        handleActorUpdate(actor, changes);
    });

    Hooks.on('updateJournalEntry', (entry: JournalEntry, changes: Record<string, unknown>) => {
        handleJournalUpdate(entry, changes);
    });
}
