/**
 * Persistence for pending Kanka ↔ Foundry conflicts.
 *
 * The registry is stored as a JSON string in a world-scoped setting so it
 * survives between sessions: a conflict found while a player imports at one
 * moment is still waiting for the GM to resolve when they next log in. The
 * registry holds pure data only — no callbacks — so it serializes cleanly; the
 * apply/revalidate logic lives with the entities (`syncBack`, `campaignJournal`)
 * and is orchestrated by `resolveConflicts`.
 */

import { logError } from '../../util/logger';
import { type StoredConflict, isStoredConflict } from './types';

const SETTING_KEY = 'pendingConflicts';

/** Narrow to an array without `Array.isArray`'s `any[]` widening. */
// eslint-disable-next-line no-restricted-syntax -- boundary: type-guard parameter fed straight into the guard below
function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

/** Read and validate the persisted conflict list. */
export function listConflicts(): StoredConflict[] {
    const raw = game.settings?.get('kanka-foundry', SETTING_KEY) ?? '';
    if (!raw) return [];

    // eslint-disable-next-line no-restricted-syntax -- boundary: JSON.parse output, validated by isStoredConflict below
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        logError('Failed to parse stored Kanka conflicts; resetting', error);
        return [];
    }

    if (!isUnknownArray(parsed)) return [];
    return parsed.filter(isStoredConflict);
}

async function persist(conflicts: StoredConflict[]): Promise<void> {
    await game.settings?.set('kanka-foundry', SETTING_KEY, JSON.stringify(conflicts));
}

/**
 * Upsert conflicts by id: a re-detected conflict refreshes its stored values
 * rather than duplicating, so the registry never grows on repeated reconciles.
 */
export async function addConflicts(incoming: StoredConflict[]): Promise<void> {
    if (incoming.length === 0) return;

    const byId = new Map<string, StoredConflict>();
    for (const conflict of listConflicts()) byId.set(conflict.id, conflict);
    for (const conflict of incoming) byId.set(conflict.id, conflict);

    await persist([...byId.values()]);
}

/** Remove a single resolved conflict. */
export async function removeConflict(id: string): Promise<void> {
    const remaining = listConflicts().filter((conflict) => conflict.id !== id);
    await persist(remaining);
}

/** Replace the whole registry (used by revalidation to drop stale entries). */
export async function setConflicts(conflicts: StoredConflict[]): Promise<void> {
    await persist(conflicts);
}
