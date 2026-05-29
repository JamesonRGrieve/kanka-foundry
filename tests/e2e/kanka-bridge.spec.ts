import { expect, test } from '@playwright/test';
import { joinAndEnableKanka } from './lib/foundry';

test.describe('kanka-foundry Tier B (against the wh40k-rpg system)', () => {
    test('module activates in the wh40k-rpg world', async ({ page }) => {
        const active = await joinAndEnableKanka(page);
        expect(active).toBe(true);
    });

    test('item bridge clones a dh2 compendium weapon into a world Item', async ({ page }) => {
        const active = await joinAndEnableKanka(page);
        expect(active).toBe(true);

        // Discover a real dh2 weapon compendium UUID from the installed system,
        // rather than hardcoding one (pack contents evolve).
        const uuid = await page.evaluate(async () => {
            for (const pack of game.packs) {
                if (pack?.metadata?.type !== 'Item') continue;
                const id = String(pack.collection ?? pack.metadata?.id ?? '');
                if (!/dh2/.test(id) || !/weapon/.test(id)) continue;
                const index = await pack.getIndex();
                const first = index.contents?.[0] ?? [...index][0];
                if (first?._id) return `Compendium.${pack.collection}.Item.${first._id}`;
            }
            return null;
        });
        test.skip(uuid === null, 'no dh2 weapon compendium present in this build');

        // Drive the real bridge: a fabricated Kanka item carrying the compendium
        // UUID as its foundry_uuid attribute should yield a world Item cloned
        // from that template, stamped for idempotency + write-back.
        const result = await page.evaluate(async (u) => {
            const mod = game.modules.get('kanka-foundry');
            if (!mod?.api?.bridgeKankaItem) return { error: 'api.bridgeKankaItem not exposed' };
            const entity = {
                id: 990001,
                entity_id: 990001,
                name: 'E2E Bridged Weapon',
                updated_at: '2026-01-01T00:00:00Z',
                attributes: [{ id: 1, name: 'foundry_uuid', value: u, type: 'text', is_private: true }],
            };
            await mod.api.bridgeKankaItem(entity, 4711);
            const item = game.items.find((i) => i.getFlag?.('kanka-foundry', 'entityId') === 990001);
            if (!item) return { error: 'world item not created' };
            return { name: item.name, type: item.type, source: item._stats?.compendiumSource ?? null };
        }, uuid);

        expect(result.error).toBeUndefined();
        expect(result.name).toBe('E2E Bridged Weapon');
        expect(result.type).toBe('weapon');
        expect(result.source).toBe(uuid);
    });
});
