#!/usr/bin/env bash
# Copy the static files and the Vite build into the Go embed folder.
# Run `npm run build` first (it writes backend/app/static/app/).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/internal/assets/dist"
find "$dest" -mindepth 1 ! -name .gitkeep -delete
mkdir -p "$dest/static"
cp -R "$root/backend/app/static/." "$dest/static/"
