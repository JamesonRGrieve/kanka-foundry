import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.FOUNDRY_TEST_PORT ?? 30001);
const SYSTEM_DIR = process.env.KANKA_SYSTEM_DIR ?? resolve(process.cwd(), '..', '.foundry-system');
const SEED_WORLD = process.env.SEED_WORLD_NAME ?? 'wh40k-e2e';

/**
 * Gate the suite until the reused sibling Foundry world is fully booted. The
 * provisioning itself runs inside webServer.command; here we just wait for the
 * post-setup artifacts (the system served + the auto-created GM user db).
 */
export default async function globalSetup(): Promise<void> {
    if (!existsSync(resolve(SYSTEM_DIR, '.foundry-release', 'main.js'))) {
        // eslint-disable-next-line no-console
        console.log('[kanka-e2e] global-setup: sibling .foundry-release absent — specs are ignored');
        return;
    }
    const deadline = Date.now() + 180_000;
    const url = `http://127.0.0.1:${PORT}/systems/wh40k-rpg/system.json`;
    const usersDbDir = resolve(SYSTEM_DIR, '.foundry-test-data', 'Data', 'worlds', SEED_WORLD, 'data', 'users');
    while (Date.now() < deadline) {
        let httpOk = false;
        try {
            httpOk = (await fetch(url)).ok;
        } catch {
            // server not up yet
        }
        if (httpOk && existsSync(usersDbDir) && readdirSync(usersDbDir).length > 0) {
            // eslint-disable-next-line no-console
            console.log('[kanka-e2e] global-setup: Foundry world ready');
            return;
        }
        await new Promise((r) => {
            setTimeout(r, 1_000);
        });
    }
    throw new Error('[kanka-e2e] Foundry world did not become ready within 180s');
}
