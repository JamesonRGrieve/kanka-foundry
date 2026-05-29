#!/usr/bin/env bash
# Wrapper for the Tier B Foundry e2e suite. Reuses the sibling wh40k-rpg
# system's licensed Foundry install (.foundry-release). Skips cleanly when
# that install or a Node 24+ runtime is absent, unless FOUNDRY_INTEGRATION=required.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SYSTEM_DIR="${KANKA_SYSTEM_DIR:-$(cd "${DIR}/../.foundry-system" 2>/dev/null && pwd || echo "${DIR}/../.foundry-system")}"
PROBE="${SYSTEM_DIR}/.foundry-release/main.js"

if [[ ! -f "${PROBE}" ]]; then
    if [[ "${FOUNDRY_INTEGRATION:-}" == "required" ]]; then
        echo "FOUNDRY_INTEGRATION=required but ${PROBE} is missing — populate the sibling's .foundry-release" >&2
        exit 1
    fi
    echo "[kanka-e2e] Tier B skipped — ${PROBE} not found (sibling .foundry-release absent)"
    exit 0
fi

# Foundry V14 needs Node 24+. Prefer pnpm's managed runtime if newer.
PNPM_NODE="${HOME}/.local/share/pnpm/bin/node"
if [[ -x "${PNPM_NODE}" ]] && (( $("${PNPM_NODE}" -p 'process.versions.node.split(".")[0]') >= 24 )); then
    FOUNDRY_NODE="${PNPM_NODE}"
elif (( $(node -p 'process.versions.node.split(".")[0]') >= 24 )); then
    FOUNDRY_NODE="$(command -v node)"
else
    if [[ "${FOUNDRY_INTEGRATION:-}" == "required" ]]; then
        echo "FOUNDRY_INTEGRATION=required but no Node 24+ binary found" >&2
        exit 1
    fi
    echo "[kanka-e2e] Tier B skipped — Foundry V14 needs Node 24+, none found"
    exit 0
fi
export FOUNDRY_NODE
export KANKA_SYSTEM_DIR="${SYSTEM_DIR}"

# Build the module → dist/ so e2e tests the current working tree. dist/ is what
# setup-foundry-e2e.sh symlinks in as the module.
if [[ "${E2E_SKIP_BUILD:-}" != "1" ]]; then
    echo "[kanka-e2e] Building module → dist/ before e2e (set E2E_SKIP_BUILD=1 to skip)…"
    (cd "${DIR}" && pnpm build)
fi

exec playwright test -c "${DIR}/playwright.foundry.config.ts" "$@"
