import type { Page } from '@playwright/test';

/**
 * Join the test world as the auto-created Gamemaster user. Returns true on
 * success, false if the join select isn't populated (spec should skip).
 * Mirrors the sibling wh40k-rpg system's canonical join flow.
 */
async function joinAsGM(page: Page): Promise<boolean> {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    try {
        await page
            .locator('select[name="userid"] option', { hasText: /\S/ })
            .first()
            .waitFor({ state: 'attached', timeout: 30_000 });
    } catch {
        return false;
    }
    await page.selectOption('select[name="userid"]', { label: 'Gamemaster' });
    await page.click('button[name="join"]');
    await page.waitForURL(/\/game/, { timeout: 30_000 });
    await page.waitForFunction(() => (globalThis as unknown as { game?: { ready?: boolean } }).game?.ready === true, undefined, {
        timeout: 60_000,
    });
    return true;
}

/** True when the kanka-foundry module is active in the current world. */
async function kankaActive(page: Page): Promise<boolean> {
    return page.evaluate(
        () =>
            (globalThis as unknown as { game?: { modules?: { get(id: string): { active?: boolean } | undefined } } }).game?.modules?.get(
                'kanka-foundry',
            )?.active === true,
    );
}

/**
 * Join as GM and ensure the kanka-foundry module is active. If it isn't,
 * enable it via core.moduleConfiguration and reload — Foundry includes the
 * module's esmodule on the next /game load. Returns true when active.
 */
export async function joinAndEnableKanka(page: Page): Promise<boolean> {
    if (!(await joinAsGM(page))) return false;
    if (await kankaActive(page)) return true;

    await page.evaluate(async () => {
        const g = globalThis as unknown as {
            game?: { settings?: { get(s: string, k: string): unknown; set(s: string, k: string, v: unknown): Promise<unknown> } };
        };
        const current = g.game?.settings?.get('core', 'moduleConfiguration');
        const next = { ...(typeof current === 'object' && current !== null ? current : {}), 'kanka-foundry': true };
        await g.game?.settings?.set('core', 'moduleConfiguration', next);
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    // A reload may drop back to /join; re-enter if so.
    if (page.url().includes('/join')) {
        if (!(await joinAsGM(page))) return false;
    } else {
        await page.waitForFunction(() => (globalThis as unknown as { game?: { ready?: boolean } }).game?.ready === true, undefined, {
            timeout: 60_000,
        });
    }
    return kankaActive(page);
}
