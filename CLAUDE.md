# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Kanka-Foundry is a Foundry VTT module that integrates with [Kanka.io](https://kanka.io) to import worldbuilding entities as journal entries. It's a TypeScript project using Vite for building, Handlebars for templating, and Tailwind CSS for styling.

## Build & Development Commands

- `pnpm install --frozen-lockfile` — install dependencies (use instead of `pnpm install`)
- `pnpm build` — production build (output in `dist/`)
- `pnpm start` — Vite dev server with HMR (NODE_ENV=development)
- `pnpm check` — run both type checking and linting (**must pass before committing**)
- `pnpm check:types` — TypeScript type checking only
- `pnpm check:lint` — Biome linting only
- `pnpm test` — run tests with Vitest
- `pnpm test:watch` — run tests in watch mode
- `pnpm test:coverage` — run tests with coverage

### Docker Dev Workflow

1. Copy `secrets.json.dist` to `secrets.json` and fill in credentials
2. `pnpm build` (initial build)
3. `docker compose up` (runs Foundry VTT)
4. `pnpm start` (Vite dev server at http://localhost:3000)

## Architecture Overview

```
Kanka API → KankaApi/KankaFetcher (src/api/)
  → TypeLoaders (src/api/typeLoaders/) — one per entity type
  → Foundry integration (src/foundry/) — creates/updates journal entries
  → UI Apps (src/apps/) — browser, settings
  → Handlebars templates (src/handlebars/) — rendering journal pages
```

### Key Concepts

- **Entity types** (Character, Location, Organisation, etc.) each have a dedicated `TypeLoader` extending `AbstractTypeLoader` in `src/api/typeLoaders/`
- **ReferenceCollection** (`src/api/ReferenceCollection.ts`) manages cross-entity links and resolves references between imported entities
- **RateLimiter** (`src/api/RateLimiter.ts`) throttles API requests to stay within Kanka's rate limits (30/min free, 90/min subscribers)
- **syncEntities** (`src/syncEntities.ts`) orchestrates the import/update flow
- **Migrations** (`src/migrations/`) handle data format changes between module versions

### Localization

- YAML-based i18n files in `src/lang/` (en, de, it, pt_BR)
- Community translations managed via [Weblate](https://weblate.foundryvtt-hub.com/engage/kanka-foundry/)

## Kanka API Reference

When working with Kanka entity types, endpoints, or data structures, consult the official API documentation:
**https://app.kanka.io/api-docs/1.0/overview**

### Live API Access

A `KANKA_TOKEN` environment variable is available for authenticating against the Kanka API. Use it to verify actual API responses when unsure about field names, types, or structure:

```bash
curl -s -H "Authorization: Bearer $KANKA_TOKEN" -H "Accept: application/json" \
  "https://api.kanka.io/1.0/campaigns/44342" | jq .
```

Always verify response shapes against real API data rather than relying solely on documentation.

## Code Quality

- **Linters**: Biome (`biome.json`) and ESLint (`.eslintrc.json`) — both enforced
- **TypeScript**: strict mode enabled
- **Tests**: Vitest — test files are co-located with source (`*.test.ts`)
- **Formatting**: Prettier
- Always run `pnpm check` before committing

### Ratchets (one-way-valve quality gates)

Every metric below is backed by a baseline file at the repo root and a script
in `scripts/`. The rule is a one-way valve: a metric may improve, never
regress. Several ratchets **auto-flip to a hard "strict" gate** once a per-rule
or per-category count reaches 0 (further occurrences then fail with no `--update`
escape). After a genuine improvement, run the matching `*:ratchet:update` and
commit the changed baseline **in the same commit**. Never loosen a baseline to
make a regression pass — fix the source.

| Gate | Script | Direction | Baseline |
| --- | --- | --- | --- |
| `biome:ratchet` | biome diagnostics (errors+warnings) | may not rise | `.biome-warning-baseline` |
| `lint:ratchet` | ESLint warning count | may not rise; errors never allowed | `.eslint-warning-baseline` |
| `typecheck:ratchet` | `tsc -p tsconfig.json` per-TS-code | may not rise; auto-flips at 0 | `.tsc-baseline` |
| `strict:ratchet` | `tsc -p tsconfig.strict.json` per-TS-code | may not rise; auto-flips at 0 | `.strict-coverage-baseline` |
| `ts:ratchet` | per-dir `any`/`as any`/`@ts-expect-error`/`@ts-ignore` | may not rise; auto-flips at 0 | `.ts-coverage-baseline` |
| `type-coverage:ratchet` | inferred type-coverage `--strict` | covered count may not fall; auto-flips at 100% | `.type-coverage-baseline` |
| `knip:ratchet` | per-category unused detection | may not rise; auto-flips per category at 0 | `.knip-baseline` |
| `deps:ratchet` | dependency-cruiser per-rule violations (3-layer + correctness) | may not rise; auto-flips per rule at 0 | `.depcruise-baseline` |
| `dry-todo:ratchet` | `TODO(dry)` marker count | may not rise | `.dry-todo-baseline` |
| `css:ratchet` | raw CSS rule-block count (Tailwind-migration direction) | may not rise | `.css-coverage-baseline` |
| `important:ratchet` | `!important` count across CSS/SCSS | may not rise | `.important-baseline` |
| `theme:ratchet` | hardcoded hex-color count (use design tokens) — **low-baseline guard** | may not rise | `.theme-baseline` |
| `animation:ratchet` | raw `animation:` declaration count — **low-baseline guard** | may not rise | `.animation-baseline` |
| `lockfile:validate` | every `pnpm-lock.yaml` resolution host on the allow-list | hard gate | — |
| `i18n:check` | `en.yml` (reference langpack) parses; de/it/pt_BR drift is warn-only (Weblate-managed) | hard gate on en.yml only | — |

All of the above run in `.husky/pre-commit` (after `lint-staged`), followed by
`pnpm test`. Do not `--no-verify` past a failing gate without explicit
authorization. `theme`/`animation` are guards, not migration trackers — kanka
has no per-system Tailwind variant architecture, so they simply block
introducing the anti-pattern.

### Tier B e2e (Foundry) — `e2e:ratchet`

`pnpm test:e2e` runs Playwright against a **real Foundry instance**, reusing the
sibling `../.foundry-system` harness: `scripts/setup-foundry-e2e.sh` invokes the
system's `setup-foundry-test-world.sh` (which assembles a licensed Foundry +
the wh40k-rpg system + seed world), then symlinks this module's `dist/` in as a
module. Specs (`tests/e2e/`) activate the module in-world and exercise the item
bridge against the **real dh2 compendium**. `pnpm e2e:ratchet` gates the passing
count (`.e2e-baseline`): it may rise, never fall; any failure is a hard fail.

This lane is **NOT in pre-commit** (a Foundry boot is too slow) and **NOT in the
standard CI `tests.yml`** (public CI has neither the sibling system nor a
licensed Foundry — `scripts/run-e2e.sh` self-skips with exit 0 when
`../.foundry-system/.foundry-release` is absent). Run it in a licensed lane:
`FOUNDRY_INTEGRATION=required pnpm test:e2e && pnpm e2e:ratchet`. It depends on
the sibling system being checked out and built next to this repo.

## Commit Guidelines

- Do **NOT** add "Co-Authored-By" lines referencing Claude, AI, or any AI tool
- Do **NOT** mention Claude, AI, or any AI tool in commit messages
- Write commit messages as if authored by the developer
- The responsibility for any commit lies solely with the developer
- Follow [Conventional Commits](https://www.conventionalcommits.org/) style (the project uses semantic-release)
