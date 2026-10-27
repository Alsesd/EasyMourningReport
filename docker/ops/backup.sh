#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PRIMARY_DIR="${BACKUPS_PATH:-./backups}"
MIRROR_DIR="${BACKUPS_MIRROR_PATH:-}"
KEEP="${BACKUP_KEEP:-100}"
DB_NAME="${POSTGRES_DB:-mourningreport}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

mkdir -p "$PRIMARY_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="reports-${STAMP}-host.sql"
DEST="$PRIMARY_DIR/$NAME"
TEMP="$DEST.partial"

cleanup() {
  rm -f "$TEMP"
}
trap cleanup EXIT

echo "Dumping PostgreSQL database '$DB_NAME' to $DEST"
if ! docker compose exec -T -e "PGPASSWORD=$DB_PASSWORD" db \
  pg_dump -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl \
  > "$TEMP"; then
  echo "ERROR: pg_dump failed; existing backups were left untouched." >&2
  exit 1
fi
mv "$TEMP" "$DEST"
trap - EXIT
(
  cd "$PRIMARY_DIR"
  sha256sum "$NAME" > "$NAME.sha256"
)

if [[ -n "$MIRROR_DIR" ]]; then
  if mkdir -p "$MIRROR_DIR" && cp "$DEST" "$MIRROR_DIR/$NAME"; then
    (
      cd "$MIRROR_DIR"
      sha256sum "$NAME" > "$NAME.sha256"
    )
    echo "Mirrored to $MIRROR_DIR/$NAME"
  else
    echo "WARNING: primary backup succeeded, but the mirror copy failed." >&2
  fi
fi

prune() {
  local directory="$1"
  [[ -d "$directory" ]] || return 0
  ls -1t "$directory"/reports-*.sql 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old" "$old.sha256"
  done
}
prune "$PRIMARY_DIR"
if [[ -n "$MIRROR_DIR" ]]; then
  prune "$MIRROR_DIR"
fi

echo "Backup complete: $DEST"
