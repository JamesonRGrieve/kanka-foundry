import { describe, expect, it } from 'vitest';
import { STAT_MAP, STAT_REVERSE_MAP } from './actorAttributeMaps';

/**
 * Regression tests for #474 — Kanka must not mirror or source live, mutable
 * mechanical state. Foundry is the sole authority for it.
 *
 * STAT_MAP is read by actor creation, sync-back, conflict detection and the
 * sheet button, and `syncBack.ts`'s bidirectional reconcile can write a Kanka
 * value *into* the actor. So a live path appearing in this map is not merely
 * log noise — it lets a stale wiki value overwrite play state.
 */
describe('STAT_MAP (#474: durable character facts only)', () => {
    /** Foundry system paths that change during play and must never sync. */
    const LIVE_STATE_PATHS = ['fate.value', 'wounds.value', 'insanity', 'corruption', 'experience.used'];

    it.each(LIVE_STATE_PATHS)('does not map any Kanka attribute to the live path %s', (path) => {
        expect(Object.values(STAT_MAP)).not.toContain(path);
    });

    it('has no reverse entry for a live path either', () => {
        for (const path of LIVE_STATE_PATHS) {
            expect(STAT_REVERSE_MAP[path]).toBeUndefined();
        }
    });

    it('still syncs the durable capacities/totals', () => {
        expect(STAT_MAP).toEqual({
            wounds_max: 'wounds.max',
            fate_max: 'fate.max',
            xp_total: 'experience.total',
        });
    });

    it('round-trips every retained entry through the reverse map', () => {
        for (const [kankaName, foundryPath] of Object.entries(STAT_MAP)) {
            expect(STAT_REVERSE_MAP[foundryPath]).toBe(kankaName);
        }
    });
});
