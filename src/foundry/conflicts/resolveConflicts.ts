/**
 * Coordinates the persisted conflict registry with the entity-specific apply and
 * revalidate logic. The store (`conflictStore`) holds pure data; the actual
 * reads/writes against actors and the campaign live in `syncBack` /
 * `campaignJournal`. This module is the single seam the ConflictResolver app and
 * the ready hook talk to.
 */

import { applyCampaignConflict, isCampaignConflictValid } from '../campaignJournal';
import { applyActorConflict, recomputeActorConflictIds } from '../syncBack';
import { listConflicts, removeConflict, setConflicts } from './conflictStore';
import type { ConflictChoice, StoredConflict } from './types';

/**
 * Drop stored conflicts that are no longer divergent (the values may have been
 * reconciled out-of-band since they were recorded). Actor conflicts are
 * revalidated per-actor with a single attribute fetch each; the campaign
 * conflict is re-checked directly. Returns the surviving conflicts.
 */
export async function revalidateConflicts(): Promise<StoredConflict[]> {
    const all = listConflicts();
    if (all.length === 0) return [];

    const actorIds = new Set(all.filter((conflict) => conflict.entityType === 'actor').map((conflict) => conflict.entityId));
    const validIdsByActor = new Map<string, Set<string>>();
    await Promise.all(
        [...actorIds].map(async (actorId) => {
            validIdsByActor.set(actorId, await recomputeActorConflictIds(actorId));
        }),
    );

    // Campaign conflicts need an async re-check; resolve them all up front so the
    // filter pass below stays synchronous (no await-in-loop).
    const campaignConflicts = all.filter((conflict) => conflict.entityType === 'campaign');
    const campaignValidity = await Promise.all(campaignConflicts.map(isCampaignConflictValid));
    const staleCampaignIds = new Set(campaignConflicts.filter((_conflict, index) => !campaignValidity[index]).map((conflict) => conflict.id));

    const kept: StoredConflict[] = [];
    for (const conflict of all) {
        if (conflict.entityType === 'actor') {
            if (validIdsByActor.get(conflict.entityId)?.has(conflict.id) === true) kept.push(conflict);
        } else if (!staleCampaignIds.has(conflict.id)) {
            kept.push(conflict);
        }
    }

    if (kept.length !== all.length) await setConflicts(kept);
    return kept;
}

/**
 * Apply the GM's choice for a single conflict and remove it from the registry on
 * success. A failed apply leaves the conflict in place so it is re-asked later.
 */
export async function resolveConflict(id: string, choice: ConflictChoice): Promise<boolean> {
    const conflict = listConflicts().find((candidate) => candidate.id === id);
    if (!conflict) return false;

    const applied = conflict.entityType === 'actor' ? await applyActorConflict(conflict, choice) : await applyCampaignConflict(conflict, choice);

    if (applied) await removeConflict(id);
    return applied;
}
