#!/bin/bash
# SessionStart hook: bootstrap npm dependencies on first run.
# Claude Code plugins are installed by file copy — no npm install runs.
# This hook ensures node_modules exists before the MCP server starts.

set -e

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"
PLUGIN_DATA="${CLAUDE_PLUGIN_DATA:-$PLUGIN_ROOT}"

if [ ! -d "$PLUGIN_ROOT/node_modules" ]; then
  echo "[telegram-plugin] First run — installing dependencies..." >&2
  cd "$PLUGIN_ROOT"
  npm install --production --no-audit --no-fund 2>&1 | tail -1 >&2
  echo "[telegram-plugin] Dependencies installed." >&2
fi

if [ ! -f "$PLUGIN_ROOT/dist/index.js" ]; then
  echo "[telegram-plugin] Building TypeScript..." >&2
  cd "$PLUGIN_ROOT"
  npm run build 2>&1 | tail -1 >&2
  echo "[telegram-plugin] Build complete." >&2
fi
