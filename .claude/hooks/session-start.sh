#!/usr/bin/env bash
# Install dependencies and build the SPA in Claude Code cloud sessions,
# so the Go binary embeds the UI and web tests find their assets from the first command.
# Local sessions are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
go mod download
(cd frontend && npm ci --silent --no-audit --no-fund && npm run build --silent >/dev/null)
