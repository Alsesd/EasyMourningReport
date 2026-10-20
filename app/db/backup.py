"""SQLite online streaming backup & background loop."""
import asyncio
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from app.db.session import DB_PATH, engine

BACKUP_DIR = DB_PATH.parent / "backups"
KEEP = max(1, int(os.getenv("BACKUP_KEEP", "100")))
EVERY_MIN = int(os.getenv("BACKUP_EVERY_MIN", "60"))


def backup_db(tag: str = "") -> Path | None:
    """Back up the local SQLite database; remote databases use provider backups."""
    if engine.dialect.name != "sqlite" or not DB_PATH.exists():
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
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
