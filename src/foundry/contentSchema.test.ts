import { describe, expect, it } from 'vitest';
import { validateItemSystem } from './contentSchema';

describe('validateItemSystem', () => {
    it('passes a well-formed ranged weapon', () => {
        expect(
            validateItemSystem('weapon', {
                class: 'heavy',
                type: 'solid-projectile',
                melee: false,
                attack: { type: 'ranged', characteristic: 'ballisticSkill' },
            }),
        ).toEqual([]);
    });

    it('catches a ranged weapon mis-typed as melee (the corruption we import-guard against)', () => {
        const errs = validateItemSystem('weapon', {
            class: 'heavy',
            type: 'solid-projectile',
            melee: true,
            attack: { type: 'melee', characteristic: 'weaponSkill' },
        });
        expect(errs.length).toBeGreaterThan(0);
        expect(errs.join(' ')).toContain('incoherent weapon');
    });

    it('catches an invalid class enum', () => {
        expect(validateItemSystem('weapon', { class: 'meele' }).length).toBeGreaterThan(0);
    });

    it('accepts a per-line variant container for class', () => {
        expect(validateItemSystem('weapon', { class: { dh2: 'basic', dw: 'basic' } })).toEqual([]);
    });

    it('accepts the neutral blank crewExposure but rejects an invalid value', () => {
        expect(validateItemSystem('vehicleTrait', { effects: { crewExposure: '' } })).toEqual([]);
        expect(validateItemSystem('vehicleTrait', { effects: { crewExposure: 'exposed' } }).length).toBeGreaterThan(0);
    });

    it('passes types that are not modelled', () => {
        expect(validateItemSystem('talent', { anything: true })).toEqual([]);
        expect(validateItemSystem('weapon', undefined)).not.toEqual(undefined);
    });
});
