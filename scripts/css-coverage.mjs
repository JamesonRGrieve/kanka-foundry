#!/usr/bin/env node
/**
 * CSS-coverage measurement for kanka-foundry.
 *
 * INTERPRETATION CHOICE: the reference system's css-coverage.mjs classifies
 * Handlebars templates as tailwind-only / mixed / css-only by inspecting every
 * `class="…"` attribute against a large allow-list of that system's permanent
 * JS-hook selectors, Font Awesome tokens, BEM structural names, etc. That
 * machinery is tightly coupled to the system's component architecture and its
 * hundreds of bespoke `wh40k-*` selectors; porting it faithfully to kanka would
 * mean reverse-engineering an allow-list that does not exist here.
 *
 * kanka has a much smaller, flatter CSS surface (one `src/styles.css` plus one
 * component `.scss`), so we implement the simpler faithful analog the brief
 * permits: measure the raw CSS *rule count* (top-level `{ … }` selector blocks,
 * excluding at-rules) across both files. The ratchet enforces that this count
 * must not RISE — pushing styling toward Tailwind utilities (which add no CSS
 * rules of their own to these source files) rather than hand-written CSS rules.
 *
 * Output: .css-coverage.json (machine-readable, used by the ratchet).
 *
 * Usage:
 *   node scripts/css-coverage.mjs            # write report + print summary
 *   node scripts/css-coverage.mjs --quiet    # write report, no stdout
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const quiet = args.has('--quiet');
const OUT = resolve(process.cwd(), '.css-coverage.json');

const SOURCES = ['src/styles.css', 'src/apps/KankaJournal/KankaJournalApplication.scss'].filter((p) =>
    existsSync(resolve(process.cwd(), p)),
);

/**
 * Count CSS rule blocks: occurrences of `{` that open a declaration block whose
 * "selector" is not an at-rule (does not start with `@`). This is deliberately
 * syntactic. Block comments are stripped first so braces inside comments do not
 * count. SCSS nested rules each count as their own block, which is the desired
 * behaviour: nesting is still a hand-written rule that Tailwind migration removes.
 */
function countRules(text) {
    const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
    let count = 0;
    let selectorStart = 0;
    for (let i = 0; i < noComments.length; i++) {
        const ch = noComments[i];
        if (ch === '{') {
            const selector = noComments.slice(selectorStart, i).trim();
            // Take the text after the previous `{`, `}` or `;` as the selector prelude.
            const lastDelim = Math.max(selector.lastIndexOf('}'), selector.lastIndexOf('{'), selector.lastIndexOf(';'));
            const prelude = (lastDelim >= 0 ? selector.slice(lastDelim + 1) : selector).trim();
            if (prelude && !prelude.startsWith('@')) count++;
            selectorStart = i + 1;
        } else if (ch === '}' || ch === ';') {
            selectorStart = i + 1;
        }
    }
    return count;
}

const perFile = {};
let totalRules = 0;
for (const rel of SOURCES) {
    const text = readFileSync(resolve(process.cwd(), rel), 'utf8');
    const n = countRules(text);
    perFile[rel] = n;
    totalRules += n;
}

const payload = {
    generatedAt: new Date().toISOString(),
    sources: SOURCES,
    perFile,
    summary: { totalRules },
};
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

if (!quiet) {
    console.log(`[css-coverage] ${totalRules} CSS rule blocks across ${SOURCES.length} source file(s):`);
    for (const rel of SOURCES) console.log(`  ${rel}: ${perFile[rel]}`);
    console.log(`Report written to ${OUT}.`);
}
process.exit(0);
