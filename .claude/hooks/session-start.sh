#!/usr/bin/env bash
# Install dependencies and build the SPA in Claude Code cloud sessions,
# so tests (including the SPA-fallback test) pass from the first command.
# Local sessions are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
uv sync --locked -q
(cd frontend && npm ci --silent --no-audit --no-fund && npm run build --silent >/dev/null)
