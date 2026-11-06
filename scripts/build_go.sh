#!/usr/bin/env bash
# Build the Go server for Linux and Windows into dist/ (gitignored).
# Needs node (22) and go on PATH. Each binary embeds the SPA and the PWA files.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
(cd frontend && npm ci && npm run build)
bash scripts/go_assets.sh
mkdir -p dist
flags=(-trimpath -ldflags="-s -w")
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build "${flags[@]}" -o dist/legkyi ./cmd/server
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build "${flags[@]}" -o dist/legkyi.exe ./cmd/server
ls -l dist/legkyi dist/legkyi.exe
