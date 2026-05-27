#!/usr/bin/env node
/**
 * CSS-coverage ratchet for kanka-foundry.
 *
 * Runs scripts/css-coverage.mjs (silently) and compares the resulting raw CSS
 * rule count to .css-coverage-baseline. The count may not RISE — every new
 * styling need should go to a Tailwind utility, not a new hand-written CSS rule
 * in src/styles.css / the component .scss. A drop ratchets the baseline down.
 *
 * Pre-commit gate. Update via: pnpm css:ratchet:update.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPORT = resolve(process.cwd(), '.css-coverage.json');
const BASELINE = resolve(process.cwd(), '.css-coverage-baseline');
const args = new Set(process.argv.slice(2));
const updateMode = args.has('--update');

execSync('node scripts/css-coverage.mjs --quiet', { stdio: 'inherit' });
const cur = JSON.parse(readFileSync(REPORT, 'utf8')).summary.totalRules;

const serialized = JSON.stringify({ totalRules: cur }, null, 2) + '\n';

if (updateMode) {
    writeFileSync(BASELINE, serialized, 'utf8');
    console.log(`[css-ratchet] baseline updated: totalRules=${cur}`);
    process.exit(0);
}

if (!existsSync(BASELINE)) {
    writeFileSync(BASELINE, serialized, 'utf8');
    console.log(`[css-ratchet] baseline file missing — initialised: totalRules=${cur}`);
    process.exit(0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8')).totalRules;

if (cur > base) {
    console.error(`[css-ratchet] FAIL: CSS rule count ${base} -> ${cur} (+${cur - base}).`);
    console.error('New styling should use Tailwind utilities, not new hand-written CSS rules.');
    console.error('If intentional, run: pnpm css:ratchet:update');
    process.exit(1);
}

if (cur < base) {
    writeFileSync(BASELINE, serialized, 'utf8');
    console.log(`[css-ratchet] ratcheted down ${base} -> ${cur}. Commit the updated baseline.`);
    process.exit(0);
}

console.log(`[css-ratchet] OK: totalRules=${cur} (unchanged, baseline ${base}).`);
process.exit(0);
