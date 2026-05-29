#!/usr/bin/env bash
#
# setup-foundry-e2e.sh — Provision the e2e Foundry instance by reusing the
# sibling wh40k-rpg system's harness (which assembles a licensed Foundry
# instance with the 40k system + seed world installed), then INSTALL the
# kanka-foundry module into that same data dir for testing.
#
# Idempotent. Invoked by playwright.foundry.config.ts's webServer.command.
#
# Env:
#   KANKA_SYSTEM_DIR   path to the sibling system repo (default: ../.foundry-system)
set -euo pipefail

KANKA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SYSTEM_DIR="${KANKA_SYSTEM_DIR:-$(cd "${KANKA_DIR}/../.foundry-system" 2>/dev/null && pwd || echo "${KANKA_DIR}/../.foundry-system")}"

if [[ ! -f "${SYSTEM_DIR}/scripts/setup-foundry-test-world.sh" ]]; then
    echo "[kanka-e2e] sibling system harness not found at ${SYSTEM_DIR} (set KANKA_SYSTEM_DIR)" >&2
    exit 2
fi
if [[ ! -d "${KANKA_DIR}/dist" ]]; then
    echo "[kanka-e2e] kanka dist/ missing — run 'pnpm build' first" >&2
    exit 3
fi

# The sibling harness symlinks ITS dist/ as the system and errors if it's
# missing — build it once if needed so the 40k system (and its compendiums,
# which the item bridge resolves against) are present.
if [[ ! -d "${SYSTEM_DIR}/dist" ]]; then
    echo "[kanka-e2e] building sibling wh40k-rpg system → dist/ (one-time)…"
    (cd "${SYSTEM_DIR}" && pnpm build)
fi

# Assemble the Foundry instance + 40k system + seed world (idempotent).
bash "${SYSTEM_DIR}/scripts/setup-foundry-test-world.sh"

# Install the kanka-foundry module: symlink our working-tree dist/ into the
# sibling's ephemeral data dir as a module. Module ACTIVATION happens in-world
# from the spec (Foundry reads core.moduleConfiguration at /game load).
MODULES_DIR="${SYSTEM_DIR}/.foundry-test-data/Data/modules"
mkdir -p "${MODULES_DIR}"
LINK="${MODULES_DIR}/kanka-foundry"
if [[ -L "${LINK}" ]] && [[ "$(readlink "${LINK}")" != "${KANKA_DIR}/dist" ]]; then
    rm -f "${LINK}"
fi
if [[ ! -e "${LINK}" ]]; then
    ln -s "${KANKA_DIR}/dist" "${LINK}"
fi

echo "[kanka-e2e] ready: kanka-foundry module installed into ${SYSTEM_DIR}/.foundry-test-data"
