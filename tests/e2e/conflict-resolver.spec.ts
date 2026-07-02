import { expect, test } from '@playwright/test';
import { joinAndEnableKanka } from './lib/foundry';

/**
 * Drives the ConflictResolver dialog against a real Foundry: seed one pending
 * conflict, open the dialog, click a side, click "Apply choices", and assert the
 * registry empties and the dialog closes. This exercises the full ApplicationV2
 * action dispatch → collectPicks → resolveConflict → removeConflict → close chain
 * that a GM performs by hand.
 */
test.describe('kanka-foundry conflict resolver', () => {
    test('apply resolves the selected conflict and closes the dialog', async ({ page }) => {
        const active = await joinAndEnableKanka(page);
        test.skip(!active, 'kanka-foundry module not active in this build');

        const setup = await page.evaluate(async () => {
            const actorTypes = game.documentTypes.Actor.filter((t: string) => t !== 'base');
            const type = actorTypes[0];
            if (!type) return { error: 'no concrete Actor type available' };

            const actor = await Actor.create({ name: 'E2E Conflict Actor', type });
            if (!actor?.id) return { error: 'actor not created' };

            // A snapshot/keep-Kanka resolution needs only the actor to exist (it
            // asks for a re-import), so it resolves without any Kanka API call.
            const conflict = {
                id: `actor:${actor.id}:character_skills`,
                kind: 'snapshot',
                entityType: 'actor',
                entityId: actor.id,
                entityName: actor.name ?? 'E2E Conflict Actor',
                label: 'character_skills',
                kankaAttr: 'character_skills',
                foundryPath: '',
                kankaValue: '{"Athletics":1}',
                foundryValue: '{}',
            };
            await game.settings.set('kanka-foundry', 'pendingConflicts', JSON.stringify([conflict]));

            const mod = game.modules.get('kanka-foundry');
            const App = mod?.api?.ConflictResolverApplication;
            if (!App) return { error: 'ConflictResolverApplication not exposed on module api' };
            await new App().render({ force: true });
            return { actorId: actor.id };
        });
        expect(setup.error).toBeUndefined();

        const dialog = page.locator('#kanka-conflict-resolver');
        await expect(dialog).toBeVisible();

        // Exactly one row should render for the seeded conflict.
        await expect(dialog.locator('[data-conflict-id]')).toHaveCount(1);

        // Pick "keep Kanka" and apply.
        await dialog.locator('input[type="radio"][value="kanka"]').first().check();
        await dialog.locator('button[data-action="resolveSelected"]').click();

        // The registry empties and the dialog closes.
        await expect(dialog).toHaveCount(0, { timeout: 10_000 });
        const remaining = await page.evaluate(() => game.settings.get('kanka-foundry', 'pendingConflicts'));
        expect(JSON.parse(typeof remaining === 'string' && remaining ? remaining : '[]')).toHaveLength(0);
    });
});
