import { describe, expect, it } from 'vitest';
import { type LeanItemStub, missingKit } from './actorFactory';

const stub = (name: string, uuid: string): LeanItemStub => ({ name, type: 'talent', img: '', _stats: { compendiumSource: uuid } });

const IRON_JAW = stub('Iron Jaw', 'Compendium.wh40k-rpg.dh2-core-items-talents.Item.ironjaw');
const SHOTGUN = stub('Shotgun', 'Compendium.wh40k-rpg.dh2-core-items-weapons.Item.shotgun');
const MAUL = stub('Shock Maul', 'Compendium.wh40k-rpg.dh2-core-items-weapons.Item.maul');

describe('missingKit', () => {
    const cases: { name: string; existing: string[]; kit: LeanItemStub[]; want: LeanItemStub[] }[] = [
        { name: 'a fresh actor gets the whole kit', existing: [], kit: [IRON_JAW, SHOTGUN], want: [IRON_JAW, SHOTGUN] },
        { name: 'a re-import adds only what is missing', existing: [IRON_JAW._stats.compendiumSource], kit: [IRON_JAW, SHOTGUN], want: [SHOTGUN] },
        {
            name: 'a fully kitted actor gets nothing',
            existing: [IRON_JAW._stats.compendiumSource, SHOTGUN._stats.compendiumSource],
            kit: [IRON_JAW, SHOTGUN],
            want: [],
        },
        { name: 'items gained in play are never removed or duplicated', existing: [MAUL._stats.compendiumSource], kit: [SHOTGUN], want: [SHOTGUN] },
        { name: 'an empty kit adds nothing', existing: [MAUL._stats.compendiumSource], kit: [], want: [] },
    ];
    for (const tc of cases) {
        it(tc.name, () => {
            expect(missingKit(new Set(tc.existing), tc.kit)).toEqual(tc.want);
        });
    }
});
