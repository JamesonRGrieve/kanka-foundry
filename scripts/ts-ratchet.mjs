#!/usr/bin/env node
/**
 * Per-rule, per-directory TS-strictness ratchet over src/.
 *
 * RATCHET — any (metric, directory) pair regressing upward fails the commit.
 * STRICT — once a metric's global total hits 0, it auto-graduates: future
 * occurrences anywhere are a hard fail with no --update escape.
 *
 * Update via: pnpm ts:ratchet:update
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const REPORT = resolve(process.cwd(), '.ts-coverage.json');
const BASELINE = resolve(process.cwd(), '.ts-coverage-baseline');
const METRICS = ['any', 'asAny', 'tsExpectError', 'tsIgnore'];
const args = process.argv.slice(2);
const updateMode = args.includes('--update');

const ROOT = resolve(process.cwd(), 'src');
const PATTERNS = {
    any: /(^|[^A-Za-z0-9_$]):\s*any\b/g,
    asAny: /\bas\s+any\b/g,
    tsExpectError: /@ts-expect-error\b/g,
    tsIgnore: /@ts-ignore\b/g,
};

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const full = `${dir}/${name}`;
        const stat = statSync(full);
        if (stat.isDirectory()) yield* walk(full);
        else if (stat.isFile() && name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts')) yield full;
    }
}

function topLevelDir(file) {
    const rel = relative(ROOT, file);
    const parts = rel.split(sep);
    return parts.length === 1 ? '_root' : parts[0];
}

const byDir = {};
const byFile = {};
const totals = Object.fromEntries(METRICS.map((m) => [m, 0]));
let totalFiles = 0;

for (const file of walk(ROOT)) {
    const source = readFileSync(file, 'utf8');
    const counts = Object.fromEntries(METRICS.map((m) => [m, 0]));
    for (const metric of METRICS) {
        const regex = new RegExp(PATTERNS[metric].source, PATTERNS[metric].flags);
        while (regex.exec(source) !== null) {
            counts[metric]++;
            totals[metric]++;
        }
    }

    const dir = topLevelDir(file);
    byDir[dir] ??= Object.fromEntries([...METRICS.map((m) => [m, 0]), ['files', 0]]);
    for (const metric of METRICS) byDir[dir][metric] += counts[metric];
    byDir[dir].files++;

    const rel = relative(process.cwd(), file);
    if (METRICS.some((metric) => counts[metric] > 0)) byFile[rel] = counts;
    totalFiles++;
}

const cur = {
    generatedAt: new Date().toISOString(),
    summary: { files: totalFiles, ...totals },
    byDir,
    byFile,
};
writeFileSync(REPORT, JSON.stringify(cur, null, 2) + '\n', 'utf8');

function pickBaselineShape(report, strict) {
    const out = { strict: [...strict].sort(), totals: {}, byDir: {} };
    for (const m of METRICS) out.totals[m] = report.summary[m];
    for (const d of Object.keys(report.byDir).sort()) {
        out.byDir[d] = {};
        for (const m of METRICS) out.byDir[d][m] = report.byDir[d][m];
    }
    return out;
}

const baseExists = existsSync(BASELINE);
const prior = baseExists ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
const priorStrict = new Set((prior && Array.isArray(prior.strict)) ? prior.strict : []);

const strict = new Set(priorStrict);
const newlyStrict = [];
for (const m of METRICS) {
    if (totals[m] === 0 && !strict.has(m)) {
        strict.add(m);
        newlyStrict.push(m);
    }
}

const strictViolations = [];
for (const m of [...strict]) {
    if (totals[m] > 0) {
        const dirs = Object.entries(byDir)
            .filter(([, counts]) => counts[m] > 0)
            .map(([d, counts]) => `${d}=${counts[m]}`);
        strictViolations.push(`${m}: ${totals[m]} (strict — must be 0). dirs: ${dirs.join(', ')}`);
    }
}

if (strictViolations.length) {
    console.error('[ts-ratchet] STRICT-MODE VIOLATION:');
    for (const v of strictViolations) console.error('  ' + v);
    console.error('');
    console.error('These metrics previously graduated to strict (count = 0) and cannot regress.');
    console.error('Fix the new occurrences. `pnpm ts:ratchet:update` will NOT silence this.');
    process.exit(1);
}

const curBaseline = pickBaselineShape(cur, strict);
const serialized = JSON.stringify(curBaseline, null, 2) + '\n';

if (updateMode) {
    writeFileSync(BASELINE, serialized, 'utf8');
    console.log('[ts-ratchet] baseline updated. Totals:', curBaseline.totals);
    if (newlyStrict.length) console.log(`[ts-ratchet] GRADUATED to strict on update: ${newlyStrict.join(', ')}`);
    if (strict.size) console.log(`[ts-ratchet] strict metrics: ${[...strict].sort().join(', ')}`);
    process.exit(0);
}

if (!baseExists) {
    writeFileSync(BASELINE, serialized, 'utf8');
    console.log('[ts-ratchet] baseline file missing — initialised. Totals:', curBaseline.totals);
    if (strict.size) console.log(`[ts-ratchet] strict metrics: ${[...strict].sort().join(', ')}`);
    process.exit(0);
}

const failures = [];
for (const d of Object.keys(curBaseline.byDir)) {
    if (!prior.byDir[d]) continue;
    for (const m of METRICS) {
        if (strict.has(m)) continue;
        const c = curBaseline.byDir[d][m];
        const b = prior.byDir[d][m];
        if (c > b) failures.push(`${d}/${m}: ${b} -> ${c} (+${c - b})`);
    }
}

const brandNew = Object.keys(curBaseline.byDir).filter((d) => !prior.byDir[d]);

if (failures.length) {
    console.error('[ts-ratchet] FAIL:');
    for (const f of failures) console.error('  ' + f);
    console.error('Either fix the new occurrences or, if intentional, run: pnpm ts:ratchet:update');
    process.exit(1);
}

if (newlyStrict.length) {
    writeFileSync(BASELINE, serialized, 'utf8');
    console.log(`[ts-ratchet] GRADUATED to strict (count reached 0): ${newlyStrict.join(', ')}`);
    console.log('  .ts-coverage-baseline updated. Commit it alongside your changes.');
}

let improved = false;
for (const d of Object.keys(curBaseline.byDir)) {
    if (!prior.byDir[d]) continue;
    for (const m of METRICS) {
        if (curBaseline.byDir[d][m] < prior.byDir[d][m]) improved = true;
    }
}

if (brandNew.length) console.log(`[ts-ratchet] new directories (no prior baseline): ${brandNew.join(', ')}`);
if (improved && !newlyStrict.length) {
    console.log('[ts-ratchet] OK: counts decreased. Lower the baseline in the same commit: pnpm ts:ratchet:update');
} else if (!newlyStrict.length) {
    console.log('[ts-ratchet] OK: per-directory counts unchanged.');
}
if (strict.size) console.log(`[ts-ratchet] strict metrics (must remain 0): ${[...strict].sort().join(', ')}`);
process.exit(0);
