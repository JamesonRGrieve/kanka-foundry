#!/usr/bin/env node
// Animation guard for kanka-foundry.
//
// NOTE: kanka has NO per-system Tailwind variant architecture, so this is a
// LOW-BASELINE GUARD, not the reference system's `animation: <name>` →
// `tw-animate-<name>` migration tracker. It counts raw `animation:` /
// `animation-name:` CSS declarations across src/styles.css + src/**/*.scss and
// blocks the count from RISING above its current baseline — pushing new motion
// toward Tailwind utility-based animation rather than hand-written CSS.
//
// Baseline file: .animation-baseline (bare integer). Update via
// `pnpm animation:ratchet:update`.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COVERAGE = '.animation-coverage.json';
const BASELINE = '.animation-baseline';
const args = new Set(process.argv.slice(2));
const updateMode = args.has('--update');

function walk(dir, out) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.scss')) out.push(full);
    }
    return out;
}

const SOURCES = ['src/styles.css', ...walk('src', [])].filter((p) => existsSync(p)).sort();

let current = 0;
for (const path of SOURCES) {
    current += (readFileSync(path, 'utf8').match(/(?:^|[\s;{])animation(?:-name)?\s*:/gm) ?? []).length;
}
writeFileSync(
    COVERAGE,
    JSON.stringify({ generatedAt: new Date().toISOString(), sources: SOURCES, animationDeclarations: current }, null, 2) +
        '\n',
);

if (updateMode || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, `${current}\n`);
    console.log(`[animation] baseline set to ${current}`);
    process.exit(0);
}

const baseline = Number(readFileSync(BASELINE, 'utf8').trim());
if (Number.isNaN(baseline)) {
    console.error(`${BASELINE} is not a number.`);
    process.exit(2);
}

if (current > baseline) {
    console.error(
        `animation:ratchet failed — ${current} animation declarations across CSS files, baseline is ${baseline}.\n` +
            'Prefer Tailwind utility-based animation over hand-written `animation:` declarations.',
    );
    process.exit(1);
}

if (current < baseline) {
    writeFileSync(BASELINE, `${current}\n`);
    console.log(`[animation] ratcheted down ${baseline} -> ${current}. Commit the updated baseline.`);
    process.exit(0);
}

console.log(`[animation] OK (${current}, baseline ${baseline}).`);
process.exit(0);
