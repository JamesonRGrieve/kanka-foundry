import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// Tier B e2e reuses the sibling wh40k-rpg system's licensed Foundry install.
const PORT = Number(process.env.FOUNDRY_TEST_PORT ?? 30001);
const SYSTEM_DIR = process.env.KANKA_SYSTEM_DIR ?? resolve(process.cwd(), '..', '.foundry-system');
const RELEASE_DIR = resolve(SYSTEM_DIR, '.foundry-release');
const DATA_DIR = resolve(SYSTEM_DIR, '.foundry-test-data');
const SHIM = resolve(SYSTEM_DIR, 'scripts', 'foundry-hostname-shim.cjs');
const MAIN = resolve(RELEASE_DIR, 'main.js');
const NODE = process.env.FOUNDRY_NODE ?? 'node';

const FOUNDRY_PRESENT = existsSync(MAIN);
const REQUIRED = process.env.FOUNDRY_INTEGRATION === 'required';

if (!FOUNDRY_PRESENT && !REQUIRED) {
    // eslint-disable-next-line no-console
    console.log('[kanka-e2e] Tier B skipped — sibling .foundry-release not found at ' + RELEASE_DIR);
}

export default defineConfig({
    testDir: './tests/e2e',
    // When Foundry is absent and not required, ignore every spec so Playwright exits 0.
    testIgnore: FOUNDRY_PRESENT || REQUIRED ? [] : ['**/*.spec.ts'],
    // One worker: the test world holds a single Gamemaster session.
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: [['list'], ['json', { outputFile: '.e2e-results.json' }]],
    timeout: 600_000,
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: 'on-first-retry',
        browserName: 'chromium',
        // Foundry hard-requires ≥ 1366×768.
        viewport: { width: 1440, height: 900 },
        launchOptions: {
            executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        },
    },
    globalSetup: './tests/e2e/global-setup.ts',
    webServer: FOUNDRY_PRESENT
        ? {
              // Provision (sibling system + seed world + kanka module symlink) then boot.
              command: `bash scripts/setup-foundry-e2e.sh && ${NODE} --require ${SHIM} ${MAIN} --dataPath=${DATA_DIR} --port=${PORT} --noupnp --headless`,
              url: `http://127.0.0.1:${PORT}`,
              reuseExistingServer: !process.env.CI,
              timeout: 180_000,
              stdout: 'pipe',
              stderr: 'pipe',
          }
        : undefined,
    projects: [{ name: 'chromium' }],
});
