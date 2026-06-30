/**
 * Classify a Foundry actor system leaf-path back to the Kanka attribute it maps
 * to, and the conflict `kind` that governs how it is coerced/applied.
 *
 * The actor-import conflict path (`buildConflictAwareUpdate`) only has the
 * flattened Foundry path in hand (e.g. `characteristics.weaponSkill.base`); to
 * record a resolvable conflict it must recover the Kanka attribute name. The
 * reverse maps already exist for stats/characteristics; bio/origin maps are
 * keyed by Foundry field already.
 */

import { BIO_MAP, CHARACTERISTIC_REVERSE_MAP, ORIGIN_MAP, ROOT_STRING_MAP, STAT_REVERSE_MAP } from './actorAttributeMaps';
import type { ConflictKind } from './conflicts/types';

export interface FoundryFieldClassification {
    kind: ConflictKind;
    kankaAttr: string;
}

/**
 * Map a Foundry `system.*` leaf path to its Kanka attribute + conflict kind, or
 * `undefined` when the field has no Kanka counterpart (and so cannot be synced).
 */
export function classifyFoundryPath(path: string): FoundryFieldClassification | undefined {
    // `.at()` yields `string | undefined` for the runtime-optional segments even
    // though the project does not enable noUncheckedIndexedAccess; map lookups are
    // guarded by truthiness, which catches the absent (runtime `undefined`) value.
    const parts = path.split('.');
    const head = parts.at(0);

    if (head === 'characteristics') {
        const foundryKey = parts.at(1);
        if (foundryKey === undefined) return undefined;
        const base = CHARACTERISTIC_REVERSE_MAP[foundryKey];
        if (!base) return undefined;
        return { kind: 'characteristic', kankaAttr: parts.at(2) === 'advance' ? `${base}_advance` : base };
    }

    if (head === 'originPath') {
        const foundryKey = parts.at(1);
        if (foundryKey === undefined) return undefined;
        const kankaAttr = ORIGIN_MAP[foundryKey];
        return kankaAttr ? { kind: 'origin', kankaAttr } : undefined;
    }

    if (head === 'bio') {
        const foundryKey = parts.at(1);
        if (foundryKey === undefined) return undefined;
        const kankaAttr = BIO_MAP[foundryKey];
        return kankaAttr ? { kind: 'bio', kankaAttr } : undefined;
    }

    const rootAttr = ROOT_STRING_MAP[path];
    if (rootAttr) return { kind: 'rootString', kankaAttr: rootAttr };

    const statAttr = STAT_REVERSE_MAP[path];
    if (statAttr) return { kind: 'stat', kankaAttr: statAttr };

    return undefined;
}
