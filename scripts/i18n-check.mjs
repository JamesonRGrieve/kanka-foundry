#!/usr/bin/env node
/**
 * i18n key consistency check.
 *
 * Loads src/lang/en.yml as the reference langpack, flattens it to dot-path
 * keys, then compares every other translation (de, it, pt_BR) against it:
 *   - MISSING — keys present in en but absent from the translation.
 *   - EXTRA   — keys present in the translation but absent from en (stale).
 *
 * HARD GATE: en.yml — the reference langpack the module actually loads — must
 * be present and parse as valid YAML. A malformed reference langpack is a real
 * local bug, so that (and only that) fails the gate.
 *
 * The de/it/pt_BR translations are COMMUNITY-managed via Weblate (see
 * CLAUDE.md), so this script does NOT enforce drift against them: missing and
 * extra keys are reported as WARNINGS only and never fail the gate. Hand-
 * editing those files to satisfy a gate would fight the Weblate round-trip.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const LANG_DIR = resolve(process.cwd(), 'src/lang');
const REFERENCE = 'en';
const TRANSLATIONS = ['de', 'it', 'pt_BR'];

function flatten(obj, prefix = '', out = {}) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        out[prefix] = true;
        return out;
    }
    const entries = Object.entries(obj);
    if (entries.length === 0) {
        out[prefix] = true;
        return out;
    }
    for (const [key, value] of entries) {
        const path = prefix ? `${prefix}.${key}` : key;
        flatten(value, path, out);
    }
    return out;
}

function loadKeys(lang) {
    const file = resolve(LANG_DIR, `${lang}.yml`);
    const text = readFileSync(file, 'utf8');
    const parsed = parse(text) ?? {};
    return new Set(Object.keys(flatten(parsed)));
}

let refKeys;
try {
    refKeys = loadKeys(REFERENCE);
} catch (err) {
    console.error(`[i18n-check] FAIL: reference langpack ${REFERENCE}.yml is missing or invalid YAML: ${err.message}`);
    process.exit(1);
}

let totalMissing = 0;
let totalExtra = 0;

for (const lang of TRANSLATIONS) {
    let langKeys;
    try {
        langKeys = loadKeys(lang);
    } catch (err) {
        console.error(`[i18n-check] could not read ${lang}.yml: ${err.message}`);
        process.exit(2);
    }

    const missing = [...refKeys].filter((k) => !langKeys.has(k)).sort();
    const extra = [...langKeys].filter((k) => !refKeys.has(k)).sort();

    totalMissing += missing.length;
    totalExtra += extra.length;

    if (extra.length) {
        console.warn(`[i18n-check] ${lang}.yml has ${extra.length} EXTRA key(s) not in en.yml (stale; resolve via Weblate, not by hand):`);
        for (const k of extra) console.warn(`    ${k}`);
    }

    if (missing.length) {
        console.warn(`[i18n-check] ${lang}.yml is MISSING ${missing.length} key(s) present in en.yml (warning only).`);
    }

    if (!extra.length && !missing.length) {
        console.log(`[i18n-check] ${lang}.yml: OK (in sync with en.yml).`);
    }
}

console.log(
    `[i18n-check] OK: en.yml is valid. Translation drift is informational only ` +
        `(${totalMissing} missing, ${totalExtra} extra across de/it/pt_BR — manage via Weblate).`,
);
process.exit(0);
