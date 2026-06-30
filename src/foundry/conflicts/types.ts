/**
 * Shared data model for Kanka ↔ Foundry conflicts.
 *
 * A conflict is detected when both sides hold a non-empty value for the same
 * field and the values differ. Detection happens at several moments (actor
 * import, actor reconcile, campaign reconcile); every site records a
 * `StoredConflict` into a persisted registry. The registry survives between
 * sessions so the GM can resolve everything in one place the next time they
 * log in (see `conflictStore` and the ConflictResolver app).
 */

import { asRecord } from '../../util/reflection';

/** Which side of a conflict the GM chose to keep. */
export type ConflictChoice = 'kanka' | 'foundry';

/** The entity a conflict belongs to — drives which apply/revalidate path runs. */
export type ConflictEntityType = 'actor' | 'campaign';

/**
 * The shape of the conflicting field. Determines how a chosen value is coerced
 * and routed when applied:
 * - `characteristic` / `stat` — numeric actor system fields.
 * - `bio` / `origin` / `rootString` — string actor system fields.
 * - `snapshot` — JSON item collections (skills/talents/equipment). These can be
 *   pushed Foundry → Kanka, but cannot be auto-applied Kanka → Foundry
 *   (rebuilding embedded items from JSON requires a manual re-import).
 * - `campaignDescription` — the campaign description journal body.
 */
export type ConflictKind = 'characteristic' | 'stat' | 'bio' | 'origin' | 'rootString' | 'snapshot' | 'campaignDescription';

export interface StoredConflict {
    /** Stable identity used for dedupe and per-row resolution. */
    id: string;
    kind: ConflictKind;
    entityType: ConflictEntityType;
    /** Foundry document id (actor) or campaign id (as a string). */
    entityId: string;
    entityName: string;
    /** Human-readable field label shown in the resolver. */
    label: string;
    /** Kanka attribute name to write back to (empty for `campaignDescription`). */
    kankaAttr: string;
    /** Dot path under `system.*` to write back to (empty for `campaignDescription`/`snapshot`). */
    foundryPath: string;
    kankaValue: string;
    foundryValue: string;
}

/** A single field difference found by the actor reconcile pass, before it is
 *  attributed to a specific actor. `reconcileActor` adds the entity fields. */
export type ActorFieldConflict = Pick<StoredConflict, 'kind' | 'kankaAttr' | 'foundryPath' | 'label' | 'kankaValue' | 'foundryValue'>;

/** Build the stable conflict id from its coordinates. */
export function conflictId(entityType: ConflictEntityType, entityId: string, fieldKey: string): string {
    return `${entityType}:${entityId}:${fieldKey}`;
}

/** True for kinds whose values are numbers and must be coerced before writing. */
export function isNumericKind(kind: ConflictKind): boolean {
    return kind === 'characteristic' || kind === 'stat';
}

const CONFLICT_KINDS: ReadonlySet<string> = new Set<ConflictKind>(['characteristic', 'stat', 'bio', 'origin', 'rootString', 'snapshot', 'campaignDescription']);

const ENTITY_TYPES: ReadonlySet<string> = new Set<ConflictEntityType>(['actor', 'campaign']);

/** Runtime guard for a persisted conflict — defends against stale/corrupt setting data. */
// eslint-disable-next-line no-restricted-syntax -- boundary: validating opaque JSON parsed from a world setting
export function isStoredConflict(value: unknown): value is StoredConflict {
    const v = asRecord(value);
    if (v === undefined) return false;
    return (
        typeof v['id'] === 'string' &&
        typeof v['kind'] === 'string' &&
        CONFLICT_KINDS.has(v['kind']) &&
        typeof v['entityType'] === 'string' &&
        ENTITY_TYPES.has(v['entityType']) &&
        typeof v['entityId'] === 'string' &&
        typeof v['entityName'] === 'string' &&
        typeof v['label'] === 'string' &&
        typeof v['kankaAttr'] === 'string' &&
        typeof v['foundryPath'] === 'string' &&
        typeof v['kankaValue'] === 'string' &&
        typeof v['foundryValue'] === 'string'
    );
}
