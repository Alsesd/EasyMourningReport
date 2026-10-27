#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

VOLUME_NAME="${PGDATA_VOLUME:-easymourningreport_pgdata}"
if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  echo "Creating external PostgreSQL volume: $VOLUME_NAME"
  docker volume create "$VOLUME_NAME" >/dev/null
fi

mkdir -p "${DATA_PATH:-./data}" "${BACKUPS_PATH:-./backups}" "${BACKUPS_MIRROR_PATH:-./backups-mirror}"

echo "Starting EasyMourningReport"
docker compose up -d --build

echo
echo "PostgreSQL volume: $VOLUME_NAME"
echo "Primary backups:   ${BACKUPS_PATH:-./backups}"
echo "Mirror backups:    ${BACKUPS_MIRROR_PATH:-./backups-mirror}"
echo "Open http://localhost:${PORT:-8000}/"
