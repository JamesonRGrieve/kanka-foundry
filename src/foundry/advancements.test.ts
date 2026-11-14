import { describe, expect, it } from 'vitest';
import { advancementsToSystemPatch, parseAdvancements, specialisationSlug } from './advancements';

function assertType<T>(_value: unknown): asserts _value is T {}

/** A hybrid base: the five skills the Third Gen Genestealer Hybrid actually has. */
const hybridBase = {
    characteristics: {
        fellowship: { advance: 0, total: 30 },
        intelligence: { advance: 0, total: 30 },
    },
    skills: {
        awareness: { advance: 1 },
        dodge: { advance: 1 },
        commonLore: { advance: 0, entries: [] },
    },
};

describe('parseAdvancements (dh-campaign#34)', () => {
    it('reads a well-formed list', () => {
        expect(
            parseAdvancements([
                { type: 'skill', skill: 'command', advance: 2 },
                { type: 'characteristic', characteristic: 'fellowship', advance: 1 },
            ]),
        ).toEqual([
            { type: 'skill', skill: 'command', advance: 2 },
            { type: 'characteristic', characteristic: 'fellowship', advance: 1 },
        ]);
    });

    it('keeps the good entries when one line is malformed', () => {
        // One mis-authored line in a character file must not silently cost that
        // character every other advance it was given.
        const parsed = parseAdvancements([{ type: 'skill', skill: 'command', advance: 2 }, { type: 'skill', advance: 1 }, 'nonsense', null]);
        expect(parsed).toEqual([{ type: 'skill', skill: 'command', advance: 2 }]);
    });

    it('rejects a non-positive or non-finite advance', () => {
        expect(parseAdvancements([{ type: 'skill', skill: 'command', advance: 0 }])).toEqual([]);
        expect(parseAdvancements([{ type: 'skill', skill: 'command', advance: -1 }])).toEqual([]);
    });

    it('returns an empty list for anything that is not an array', () => {
        expect(parseAdvancements(undefined)).toEqual([]);
        expect(parseAdvancements({})).toEqual([]);
    });

    it('carries a specialisation only when it is a non-empty string', () => {
        expect(parseAdvancements([{ type: 'skill', skill: 'commonLore', specialisation: '', advance: 1 }])[0]).toEqual({
            type: 'skill',
            skill: 'commonLore',
            advance: 1,
        });
    });
});

describe('specialisationSlug', () => {
    it('folds case, spaces and punctuation the way the roll engine does', () => {
        // The engine matches by name OR slug, so a slug it cannot reproduce
        // leaves the specialisation owned but unmatched (wh40k#225).
        expect(specialisationSlug('High Gothic')).toBe('high-gothic');
        expect(specialisationSlug('high gothic')).toBe('high-gothic');
        expect(specialisationSlug('High-Gothic')).toBe('high-gothic');
    });

    it('keeps genuinely different specialisations apart', () => {
        expect(specialisationSlug('Imperium')).not.toBe(specialisationSlug('Imperial'));
    });
});

describe('advancementsToSystemPatch', () => {
    it('adds +5 per characteristic advance ON TOP of the base', () => {
        // Additive over the base is the whole canonical-sheet model: the vault
        // stores only how this character differs.
        const patch = advancementsToSystemPatch([{ type: 'characteristic', characteristic: 'fellowship', advance: 2 }], hybridBase);
        expect(patch['characteristics']).toEqual({ fellowship: { advance: 2, total: 40 } });
    });

    it('sets a plain skill rank', () => {
        const patch = advancementsToSystemPatch([{ type: 'skill', skill: 'command', advance: 2 }], hybridBase);
        expect(patch['skills']).toEqual({ command: { advance: 2 } });
    });

    it('appends a specialisation with a slug the roll engine can match', () => {
        const patch = advancementsToSystemPatch([{ type: 'skill', skill: 'commonLore', specialisation: 'Imperium', advance: 1 }], hybridBase);
        expect(patch['skills']).toEqual({
            commonLore: { entries: [{ name: 'Imperium', slug: 'imperium', advance: 1, bonus: 0, cost: 0 }] },
        });
    });

    it('accumulates two specialisations of the same skill rather than overwriting', () => {
        const patch = advancementsToSystemPatch(
            [
                { type: 'skill', skill: 'commonLore', specialisation: 'Imperium', advance: 1 },
                { type: 'skill', skill: 'commonLore', specialisation: 'War', advance: 1 },
            ],
            hybridBase,
        );
        const skillsEntries: unknown = patch['skills'];
        assertType<{ commonLore: { entries: Array<{ name: string }> } }>(skillsEntries);
        const entries = skillsEntries.commonLore.entries;
        expect(entries.map((e) => e.name)).toEqual(['Imperium', 'War']);
    });

    it('keeps a specialisation the BASE already granted', () => {
        // Replacing `entries` wholesale would silently strip the base's own.
        const base = {
            ...hybridBase,
            skills: { commonLore: { advance: 0, entries: [{ name: 'Underworld', slug: 'underworld', advance: 2, bonus: 0, cost: 0 }] } },
        };
        const patch = advancementsToSystemPatch([{ type: 'skill', skill: 'commonLore', specialisation: 'Imperium', advance: 1 }], base);
        const skillsEntries: unknown = patch['skills'];
        assertType<{ commonLore: { entries: Array<{ name: string; advance: number }> } }>(skillsEntries);
        const entries = skillsEntries.commonLore.entries;
        expect(entries.map((e) => e.name)).toEqual(['Underworld', 'Imperium']);
        expect(entries[0]?.advance).toBe(2);
    });

    it('BUMPS rather than duplicating when the base already has that specialisation', () => {
        // A second track with the same name is a different skill to the roll
        // engine, and splits the ranks.
        const base = {
            ...hybridBase,
            skills: { commonLore: { advance: 0, entries: [{ name: 'Imperium', slug: 'imperium', advance: 1, bonus: 0, cost: 0 }] } },
        };
        const patch = advancementsToSystemPatch([{ type: 'skill', skill: 'commonLore', specialisation: 'Imperium', advance: 3 }], base);
        const skillsEntries: unknown = patch['skills'];
        assertType<{ commonLore: { entries: Array<{ advance: number }> } }>(skillsEntries);
        const entries = skillsEntries.commonLore.entries;
        expect(entries).toHaveLength(1);
        expect(entries[0]?.advance).toBe(3);
    });

    it('never lowers a rank the base already granted', () => {
        const base = {
            ...hybridBase,
            skills: { commonLore: { advance: 0, entries: [{ name: 'Imperium', slug: 'imperium', advance: 4, bonus: 0, cost: 0 }] } },
        };
        const patch = advancementsToSystemPatch([{ type: 'skill', skill: 'commonLore', specialisation: 'Imperium', advance: 1 }], base);
        const skillsEntries: unknown = patch['skills'];
        assertType<{ commonLore: { entries: Array<{ advance: number }> } }>(skillsEntries);
        const entries = skillsEntries.commonLore.entries;
        expect(entries[0]?.advance).toBe(4);
    });

    it('produces an EMPTY patch for no advancements, so the base is untouched', () => {
        // 89 of 93 characters are in exactly this state; they must merge to a no-op.
        expect(advancementsToSystemPatch([], hybridBase)).toEqual({});
    });

    it('tolerates a base with no characteristics or skills at all', () => {
        const patch = advancementsToSystemPatch([{ type: 'characteristic', characteristic: 'fellowship', advance: 1 }], {});
        expect(patch['characteristics']).toEqual({ fellowship: { advance: 1, total: 5 } });
    });
});
