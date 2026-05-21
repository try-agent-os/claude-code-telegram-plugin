#!/bin/bash
# SessionStart hook: bootstrap npm dependencies on first run.
#
# Claude Code plugins are installed by file copy — no npm install runs by default.
# This hook ensures node_modules + compiled dist/ exist before the MCP server starts.
#
# NOTE: This runs in-place inside ${CLAUDE_PLUGIN_ROOT}, which is the per-version
# cache directory. On plugin update, a new version directory is created and this
# hook runs again. node_modules from the old version is NOT carried over — fresh
# install each version. That's intentional and matches plugin caching semantics.
#
# For persistent state across versions, use ${CLAUDE_PLUGIN_DATA} instead.

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"

cd "$PLUGIN_ROOT"

if [ ! -d "$PLUGIN_ROOT/node_modules" ]; then
  echo "[telegram-plugin] First run — installing dependencies (this may take a minute)..." >&2
  # Install ALL deps including devDependencies — typescript is needed at build time.
  # --no-audit --no-fund suppress nag output.
  if ! npm install --no-audit --no-fund 2>&1 | tail -3 >&2; then
    echo "[telegram-plugin] npm install failed. Run manually in $PLUGIN_ROOT to see full output." >&2
    exit 1
  fi
  echo "[telegram-plugin] Dependencies installed." >&2
fi

if [ ! -f "$PLUGIN_ROOT/dist/index.js" ]; then
  echo "[telegram-plugin] Building TypeScript..." >&2
  if ! npm run build 2>&1 | tail -3 >&2; then
    echo "[telegram-plugin] Build failed. Run 'npm run build' in $PLUGIN_ROOT to see full output." >&2
    exit 1
  fi
  echo "[telegram-plugin] Build complete." >&2
fi
