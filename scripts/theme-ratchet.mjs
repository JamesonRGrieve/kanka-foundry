#!/usr/bin/env node
// Theme guard for kanka-foundry.
//
// NOTE: kanka has NO per-system Tailwind variant architecture, so this is a
// LOW-BASELINE GUARD, not the reference system's per-system `<system>:tw-*`
// adoption tracker. It counts hardcoded hex colors (`#rrggbb` / `#rgb`) across
// src/styles.css + src/**/*.scss and blocks the count from RISING above its
// current baseline — pushing new color usage toward design tokens / Tailwind
// color utilities rather than hardcoded hex.
//
// Baseline file: .theme-baseline (bare integer). Update via
// `pnpm theme:ratchet:update`.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COVERAGE = '.theme-coverage.json';
const BASELINE = '.theme-baseline';
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

// Match #rgb, #rgba, #rrggbb, #rrggbbaa hex color literals.
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

const perFile = {};
let current = 0;
for (const path of SOURCES) {
    const count = (readFileSync(path, 'utf8').match(HEX_RE) ?? []).length;
    perFile[path] = count;
    current += count;
}
writeFileSync(
    COVERAGE,
    JSON.stringify({ generatedAt: new Date().toISOString(), sources: SOURCES, perFile, hardcodedHex: current }, null, 2) +
        '\n',
);

if (updateMode || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, `${current}\n`);
    console.log(`[theme] baseline set to ${current}`);
    process.exit(0);
}

const baseline = Number(readFileSync(BASELINE, 'utf8').trim());
if (Number.isNaN(baseline)) {
    console.error(`${BASELINE} is not a number.`);
    process.exit(2);
}

if (current > baseline) {
    console.error(
        `theme:ratchet failed — ${current} hardcoded hex colors across CSS files, baseline is ${baseline}.\n` +
            'Prefer design tokens / Tailwind color utilities over hardcoded hex values.',
    );
    process.exit(1);
}

if (current < baseline) {
    writeFileSync(BASELINE, `${current}\n`);
    console.log(`[theme] ratcheted down ${baseline} -> ${current}. Commit the updated baseline.`);
    process.exit(0);
}

console.log(`[theme] OK (${current}, baseline ${baseline}).`);
process.exit(0);
