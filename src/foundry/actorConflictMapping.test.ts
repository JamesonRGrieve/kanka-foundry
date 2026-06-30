import { describe, expect, it } from 'vitest';
import { classifyFoundryPath } from './actorConflictMapping';

describe('classifyFoundryPath', () => {
    it('maps a characteristic base path to its Kanka short name', () => {
        expect(classifyFoundryPath('characteristics.weaponSkill.base')).toEqual({ kind: 'characteristic', kankaAttr: 'WS' });
    });

    it('maps a characteristic advance path with the _advance suffix', () => {
        expect(classifyFoundryPath('characteristics.ballisticSkill.advance')).toEqual({ kind: 'characteristic', kankaAttr: 'BS_advance' });
    });

    it('maps stat, bio and origin paths', () => {
        expect(classifyFoundryPath('wounds.max')).toEqual({ kind: 'stat', kankaAttr: 'wounds_max' });
        expect(classifyFoundryPath('experience.total')).toEqual({ kind: 'stat', kankaAttr: 'xp_total' });
        expect(classifyFoundryPath('bio.gender')).toEqual({ kind: 'bio', kankaAttr: 'bio_gender' });
        expect(classifyFoundryPath('originPath.homeWorld')).toEqual({ kind: 'origin', kankaAttr: 'origin_homeWorld' });
    });

    it('maps the faction root string field', () => {
        expect(classifyFoundryPath('faction')).toEqual({ kind: 'rootString', kankaAttr: 'bio_faction' });
    });

    it('returns undefined for paths with no Kanka counterpart', () => {
        expect(classifyFoundryPath('characteristics.unknownChar.base')).toBeUndefined();
        expect(classifyFoundryPath('bio.unmapped')).toBeUndefined();
        expect(classifyFoundryPath('originPath')).toBeUndefined();
        expect(classifyFoundryPath('somethingElse')).toBeUndefined();
    });
});
