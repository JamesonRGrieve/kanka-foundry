import { describe, expect, it } from 'vitest';
import { type KitItemRef, type LeanItemStub, identityUpdate, missingBaseKit } from './actorFactory';

const stub = (name: string, uuid: string): LeanItemStub => ({ name, type: 'talent', img: '', _stats: { compendiumSource: uuid } });
const held = (item: LeanItemStub): KitItemRef => ({ name: item.name, type: item.type, source: item._stats.compendiumSource });

const IRON_JAW = stub('Iron Jaw', 'Compendium.wh40k-rpg.dh2-core-items-talents.Item.ironjaw');
const SHOTGUN = stub('Shotgun', 'Compendium.wh40k-rpg.dh2-core-items-weapons.Item.shotgun');
const MAUL = stub('Shock Maul', 'Compendium.wh40k-rpg.dh2-core-items-weapons.Item.maul');
const SMOKE = stub('Smoke Grenade', 'Compendium.wh40k-rpg.dh2-core-items-weapons.Item.smoke');
// A base item with no compendium link (e.g. a Dreadnought's Basic Melee Attack) matches on type + name.
const UNARMED = { name: 'Unarmed', type: 'weapon', system: { class: 'melee' } };

describe('missingBaseKit', () => {
    const cases: { name: string; existing: KitItemRef[]; kit: object[]; want: object[] }[] = [
        { name: 'a fresh actor gets the whole kit', existing: [], kit: [IRON_JAW, SHOTGUN], want: [IRON_JAW, SHOTGUN] },
        { name: 'a re-import adds only what is missing', existing: [held(IRON_JAW)], kit: [IRON_JAW, SHOTGUN], want: [SHOTGUN] },
        { name: 'a fully kitted actor gets nothing', existing: [held(IRON_JAW), held(SHOTGUN)], kit: [IRON_JAW, SHOTGUN], want: [] },
        { name: 'items gained in play are never removed or duplicated', existing: [held(MAUL)], kit: [SHOTGUN], want: [SHOTGUN] },
        { name: 'an empty kit adds nothing', existing: [held(MAUL)], kit: [], want: [] },
        { name: 'it is count-aware: two grenades in the kit, one held, grants one', existing: [held(SMOKE)], kit: [SMOKE, SMOKE], want: [SMOKE] },
        {
            name: 'an unlinked base item matches by type and name, so a refresh never stacks it again',
            existing: [{ name: 'Unarmed', type: 'weapon', source: undefined }],
            kit: [UNARMED],
            want: [],
        },
    ];
    for (const tc of cases) {
        it(tc.name, () => {
            expect(missingBaseKit(tc.existing, tc.kit)).toEqual(tc.want);
        });
    }

    it('an unlinked base item the actor lacks is added', () => {
        expect(missingBaseKit([], [UNARMED])).toEqual([UNARMED]);
    });

    it('a linked kit entry is not satisfied by an unlinked item of the same name', () => {
        const unlinkedShotgun: KitItemRef = { name: 'Shotgun', type: 'talent', source: undefined };
        expect(missingBaseKit([unlinkedShotgun], [SHOTGUN])).toEqual([SHOTGUN]);
    });
});

describe('identityUpdate', () => {
    it('re-asserts name, flags, the Kanka portrait and narrative keys, never mechanical stats', () => {
        const update = identityUpdate({
            name: 'Wulf Tavik',
            img: 'https://wiki.test/w.jpg',
            flags: { 'kanka-foundry': { kankaEntityId: 373 } },
            system: { bio: { notes: 'x' }, wounds: { max: 14, value: 14 }, characteristics: { ws: { base: 37 } } },
        });
        expect(update).toEqual({
            name: 'Wulf Tavik',
            img: 'https://wiki.test/w.jpg',
            flags: { 'kanka-foundry': { kankaEntityId: 373 } },
            'system.bio': { notes: 'x' },
        });
    });

    it('keeps the current portrait when Kanka supplies none', () => {
        expect(identityUpdate({ name: 'A', flags: {}, img: undefined, system: {} })).not.toHaveProperty('img');
    });
});
