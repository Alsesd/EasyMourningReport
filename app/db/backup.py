"""SQLite online streaming backup & background loop."""

import asyncio
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from app.db.session import DB_PATH

def _get_backup_dir() -> Path:
    env_dir = os.getenv("LEGKYI_BACKUPS_DIR") or os.getenv("BACKUPS_DIR")
    if env_dir:
        return Path(env_dir).expanduser().resolve()
    return DB_PATH.parent / "backups"


BACKUP_DIR = _get_backup_dir()
KEEP = max(1, int(os.getenv("BACKUP_KEEP", "100")))  # keep at least one backup
EVERY_MIN = int(os.getenv("BACKUP_EVERY_MIN", "60"))  # how often the background check runs


def backup_db(tag: str = "") -> Path | None:
    """Copy reports.db into backups/ using SQLite's online backup (safe while the app is running).
    Without a tag the copy is skipped when nothing changed since the last backup."""
    if not DB_PATH.exists():
        return None
    BACKUP_DIR.mkdir(exist_ok=True)
    existing = sorted(BACKUP_DIR.glob("reports-*.db"))
    if not tag and existing and DB_PATH.stat().st_mtime <= existing[-1].stat().st_mtime:
        return None
    dest = BACKUP_DIR / f"reports-{datetime.now():%Y%m%d-%H%M%S}{'-' + tag if tag else ''}.db"
    src, dst = sqlite3.connect(DB_PATH), sqlite3.connect(dest)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    for old in sorted(BACKUP_DIR.glob("reports-*.db"))[:-KEEP]:
        old.unlink()
    return dest


async def backup_loop():
    while True:
        await asyncio.sleep(EVERY_MIN * 60)
        await asyncio.to_thread(backup_db)
