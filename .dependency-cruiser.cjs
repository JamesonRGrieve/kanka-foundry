/**
 * dependency-cruiser rules for kanka-foundry's architecture (see CLAUDE.md):
 *   - api/      — Kanka API client + typeLoaders (lower layer, pure data)
 *   - foundry/  — Foundry integration
 *   - apps/     — UI applications (upper layer)
 *   - handlebars/, migrations/, state/, util/, types/
 *
 * Conservative correctness rules plus one layering rule: the api layer must
 * not depend on the apps (UI) layer, since api is lower than apps.
 *
 * All rules emit at `warn`. The companion ratchet (scripts/depcruise-ratchet.mjs)
 * holds per-rule counts down and auto-flips each rule to strict (must be 0)
 * once its violation count reaches 0 — at which point the severity here can be
 * promoted to `error`.
 */
module.exports = {
    extends: undefined,
    forbidden: [
        {
            name: 'no-circular',
            severity: 'warn',
            comment: 'Modules should not depend on themselves transitively.',
            from: {},
            to: { circular: true },
        },
        {
            name: 'no-orphans',
            severity: 'warn',
            comment: 'Files imported by nothing.',
            from: {
                orphan: true,
                pathNot: [
                    '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
                    '\\.d\\.ts$',
                    '\\.test\\.ts$',
                    '(^|/)index\\.ts$',
                    'src/index\\.ts$',
                ],
            },
            to: {},
        },
        {
            name: 'no-deprecated-core',
            severity: 'warn',
            comment: 'Do not import from deprecated Node core modules.',
            from: {},
            to: { dependencyTypes: ['deprecated'] },
        },
        {
            name: 'no-non-package-json',
            severity: 'warn',
            comment: 'Every npm dependency used in source must be declared in package.json.',
            from: {},
            to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
        },
        {
            name: 'no-test-into-prod',
            severity: 'warn',
            comment: 'Production modules under src/ must not import from *.test.ts.',
            from: { path: '^src/', pathNot: '\\.test\\.ts$' },
            to: { path: '\\.test\\.ts$' },
        },
        {
            name: 'api-must-not-depend-on-apps',
            severity: 'warn',
            comment:
                'The api layer (Kanka client + typeLoaders) is lower than the UI layer. It must not import from src/apps/.',
            from: { path: '^src/api/' },
            to: { path: '^src/apps/' },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        exclude: {
            path: ['^node_modules', '^dist', '\\.test\\.ts$'],
        },
        includeOnly: '^src/',
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default', 'types'],
            extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.d.ts'],
        },
        reporterOptions: {
            text: { highlightFocused: true },
        },
    },
};
