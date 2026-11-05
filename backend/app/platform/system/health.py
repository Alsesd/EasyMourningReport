"""Database and backup health shown on the administration overview."""

from datetime import datetime, timezone

from app.db.backup import EVERY_MIN, integrity_check, list_backups
from app.db.session import DB_PATH, JOURNAL_MODE
from app.platform.system.schemas import SystemHealthDTO


def health() -> SystemHealthDTO:
    backups = list_backups()
    verdict = integrity_check()
    size = sum(p.stat().st_size for p in (DB_PATH, DB_PATH.with_name(DB_PATH.name + "-wal")) if p.exists())
    return SystemHealthDTO(
        database_ok=verdict == "ok",
        integrity=verdict,
        journal_mode=JOURNAL_MODE,
        database_size_bytes=size,
        backups_count=len(backups),
        last_backup_at=(
            datetime.fromtimestamp(backups[0].stat().st_mtime, tz=timezone.utc) if backups else None
        ),
        backup_every_min=EVERY_MIN,
    )
