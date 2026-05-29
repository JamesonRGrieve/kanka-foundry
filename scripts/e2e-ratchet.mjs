#!/usr/bin/env node
/**
 * Tier B e2e passed-count ratchet. The number of passing Foundry e2e tests may
 * rise, never fall — a one-way valve like the other ratchets, but counting
 * proven end-to-end behaviours rather than lint/type findings.
 *
 * Reads the Playwright JSON report (.e2e-results.json, written by
 * `pnpm test:e2e`) and compares the passing count to `.e2e-baseline`.
 *
 *   - any e2e failure        -> FAIL (fix it; never ratchet over a red test)
 *   - passed < baseline      -> FAIL (a previously-proven behaviour regressed)
 *   - passed > baseline      -> baseline ratchets up (commit .e2e-baseline)
 *   - no results file        -> SKIP (e2e wasn't run — e.g. no licensed Foundry)
 *
 * Usage:
 *   node scripts/e2e-ratchet.mjs            # check
 *   node scripts/e2e-ratchet.mjs --update   # rebaseline to current passing count
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const RESULTS = resolve(ROOT, '.e2e-results.json');
const BASELINE = resolve(ROOT, '.e2e-baseline');
const update = process.argv.includes('--update');

if (!existsSync(RESULTS)) {
    console.log('[e2e-ratchet] no .e2e-results.json — e2e not run (skipped). Run `pnpm test:e2e` first.');
    process.exit(0);
}

const report = JSON.parse(readFileSync(RESULTS, 'utf8'));
const stats = report.stats ?? {};
const passed = Number(stats.expected ?? 0);
const failed = Number(stats.unexpected ?? 0);

if (failed > 0) {
    console.error(`[e2e-ratchet] FAIL: ${failed} e2e test(s) failing. Fix them before ratcheting.`);
    process.exit(1);
}

const save = (n) => writeFileSync(BASELINE, `${JSON.stringify({ passed: n }, null, 2)}\n`);

if (update || !existsSync(BASELINE)) {
    save(passed);
    console.log(`[e2e-ratchet] baseline set to ${passed} passing test(s).`);
    process.exit(0);
}

const baseline = Number(JSON.parse(readFileSync(BASELINE, 'utf8')).passed ?? 0);
if (passed < baseline) {
    console.error(`[e2e-ratchet] FAIL: passing e2e tests fell ${baseline} -> ${passed}. Restore the behaviour or justify in the baseline commit.`);
    process.exit(1);
}
if (passed > baseline) {
    save(passed);
    console.log(`[e2e-ratchet] ratcheted up ${baseline} -> ${passed}. Commit .e2e-baseline.`);
    process.exit(0);
}
console.log(`[e2e-ratchet] OK: ${passed} passing (baseline ${baseline}).`);
