#!/usr/bin/env node
// Ratchet for `!important` declarations across kanka's CSS files
// (src/styles.css and any src/**/*.scss).
//
// Each `!important` is a cascade workaround. The count may not rise; a drop
// ratchets the baseline down. Update via `pnpm important:ratchet:update`.
//
// Baseline file: .important-baseline (bare integer).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COVERAGE = '.important-coverage.json';
const BASELINE = '.important-baseline';
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

const perFile = {};
let current = 0;
for (const path of SOURCES) {
    const count = (readFileSync(path, 'utf8').match(/!important/g) ?? []).length;
    perFile[path] = count;
    current += count;
}
writeFileSync(
    COVERAGE,
    JSON.stringify(
        { generatedAt: new Date().toISOString(), sources: SOURCES, perFile, totalImportant: current },
        null,
        2,
    ) + '\n',
);

if (updateMode || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, `${current}\n`);
    console.log(`[important] baseline set to ${current}`);
    process.exit(0);
}

const baseline = Number(readFileSync(BASELINE, 'utf8').trim());
if (Number.isNaN(baseline)) {
    console.error(`${BASELINE} is not a number.`);
    process.exit(2);
}

if (current > baseline) {
    console.error(
        `important:ratchet failed — ${current} \`!important\` declarations across CSS files, baseline is ${baseline}.\n` +
            'Each `!important` is a cascade workaround. Prefer inline Tailwind utilities over forcing specificity.',
    );
    process.exit(1);
}

if (current < baseline) {
    writeFileSync(BASELINE, `${current}\n`);
    console.log(`[important] ratcheted down ${baseline} -> ${current}. Commit the updated baseline.`);
    process.exit(0);
}

console.log(`[important] OK (${current}, baseline ${baseline}).`);
process.exit(0);
