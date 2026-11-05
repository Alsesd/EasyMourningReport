"""SQLite online streaming backup & background loop."""

import asyncio
import logging
import os
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

from app.db.session import DB_PATH

logger = logging.getLogger(__name__)

def _get_backup_dir() -> Path:
    env_dir = os.getenv("LEGKYI_BACKUPS_DIR")
    if env_dir:
        return Path(env_dir.strip("\"'")).expanduser().resolve()
    return DB_PATH.parent / "backups"


BACKUP_DIR = _get_backup_dir()
KEEP = max(1, int(os.getenv("BACKUP_KEEP", "100")))  # keep at least one backup
EVERY_MIN = int(os.getenv("BACKUP_EVERY_MIN", "60"))  # how often the background check runs


def _last_change() -> float:
    """Newest modification time of the database, including its WAL file (where new writes land first)."""
    times = [p.stat().st_mtime for p in (DB_PATH, DB_PATH.with_name(DB_PATH.name + "-wal")) if p.exists()]
    return max(times, default=0.0)


def backup_db(tag: str = "") -> Path | None:
    """Copy reports.db into backups/ using SQLite's online backup (safe while the app is running).

    Without a tag the copy is skipped when nothing changed since the last backup. Every copy is
    a self-contained single file (rollback journal mode) and is verified with ``quick_check``;
    a copy that fails the check is deleted and an error raised.
    """
    if not DB_PATH.exists():
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    existing = list_backups()
    if not tag and existing and _last_change() <= existing[0].stat().st_mtime:
        return None
    dest = BACKUP_DIR / f"reports-{datetime.now():%Y%m%d-%H%M%S}{'-' + tag if tag else ''}.db"
    src, dst = sqlite3.connect(DB_PATH), sqlite3.connect(dest)
    try:
        src.backup(dst)
        dst.execute("PRAGMA journal_mode=DELETE")
        verdict = dst.execute("PRAGMA quick_check").fetchone()[0]
    finally:
        dst.close()
        src.close()
    if verdict != "ok":
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"Backup failed its integrity check: {verdict}")
    for old in list_backups()[KEEP:]:
        try:
            old.unlink(missing_ok=True)
        except OSError:
            pass
    return dest


def list_backups() -> list[Path]:
    """Backup files, newest first (names start with a sortable timestamp)."""
    if not BACKUP_DIR.is_dir():
        return []
    return sorted(BACKUP_DIR.glob("reports-*.db"), reverse=True)


def integrity_check() -> str:
    """``PRAGMA quick_check`` of the live database: "ok" or the first problem SQLite reports."""
    if not DB_PATH.exists():
        return "ok"
    with closing(sqlite3.connect(DB_PATH, timeout=30)) as conn:
        return conn.execute("PRAGMA quick_check").fetchone()[0]


async def backup_loop():
    """Periodic backups inside the app process; a failed run is logged and retried next time."""
    while True:
        await asyncio.sleep(max(1, EVERY_MIN) * 60)
        try:
            await asyncio.to_thread(backup_db)
        except Exception:
            logger.exception("Scheduled database backup failed")
