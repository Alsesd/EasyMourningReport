"""PostgreSQL backup utility, background loop, and snapshot download router."""

import asyncio
import logging
import os
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.core.database import Base, engine, get_db
from app.core.paths import data_dir
from app.features.audit.service import record_audit as audit
from app.features.auth.dependencies import admin_required
from app.features.auth.models import User

logger = logging.getLogger(__name__)


def _get_backup_dir() -> Path:
    env_dir = (
        os.getenv("LEGKYI_BACKUPS_DIR")
        or os.getenv("BACKUPS_DIR")
        or os.getenv("BACKUPS_PATH")
    )
    if env_dir:
        return Path(env_dir.strip("\"'")).expanduser().resolve()
    return data_dir() / "backups"


BACKUP_DIR = _get_backup_dir()
KEEP = max(1, int(os.getenv("BACKUP_KEEP", "100")))
EVERY_MIN = int(os.getenv("BACKUP_EVERY_MIN", "60"))


def backup_db(tag: str = "") -> Path | None:
    """Generate a PostgreSQL SQL backup into BACKUP_DIR."""
    active_backup_dir = BACKUP_DIR
    active_backup_dir.mkdir(parents=True, exist_ok=True)

    dest = (
        active_backup_dir
        / f"reports-{datetime.now():%Y%m%d-%H%M%S}{'-' + tag if tag else ''}.sql"
    )

    url = engine.url
    pg_dump = shutil.which("pg_dump")
    if pg_dump and url.database:
        env = os.environ.copy()
        if url.password:
            env["PGPASSWORD"] = url.password
        cmd = [
            pg_dump,
            "-h",
            url.host or "localhost",
            "-p",
            str(url.port or 5432),
            "-U",
            url.username or "postgres",
            "-d",
            url.database,
            "--no-owner",
            "--no-acl",
            "-f",
            str(dest),
        ]
        try:
            subprocess.run(cmd, env=env, check=True, capture_output=True)
        except Exception:
            dest.unlink(missing_ok=True)
            return None
    else:
        # Programmatic SQL table dump fallback (ANSI SQL compliant)
        try:
            with open(dest, "w", encoding="utf-8") as f:
                f.write(
                    f"-- EasyMourningReport SQL Backup: {datetime.now().isoformat()}\n\n"
                )
                with engine.connect() as conn:
                    for table in Base.metadata.sorted_tables:
                        f.write(f"-- Table: {table.name}\n")
                        rows = conn.execute(table.select()).mappings().all()
                        for row in rows:
                            cols = ", ".join(f'"{k}"' for k in row.keys())
                            vals = []
                            for v in row.values():
                                if v is None:
                                    vals.append("NULL")
                                elif isinstance(v, bool):
                                    vals.append("TRUE" if v else "FALSE")
                                elif isinstance(v, (int, float)):
                                    vals.append(str(v))
                                else:
                                    vals.append(
                                        "'" + str(v).replace("'", "''") + "'"
                                    )
                            val_str = ", ".join(vals)
                            f.write(
                                f"INSERT INTO {table.name} ({cols}) VALUES ({val_str});\n"
                            )
                        f.write("\n")
        except Exception:
            dest.unlink(missing_ok=True)
            return None

    for old in sorted(active_backup_dir.glob("reports-*.sql"))[:-KEEP]:
        try:
            old.unlink(missing_ok=True)
        except OSError:
            pass
    return dest



async def backup_loop():
    while True:
        await asyncio.sleep(EVERY_MIN * 60)
        await asyncio.to_thread(backup_db)


backup_router = APIRouter()


@backup_router.get("/admin/backup/download")
def download_backup_snapshot(
    request: Request,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    """Generate an on-demand live PostgreSQL backup snapshot and stream it as an attachment."""
    backup_file: Path | None = backup_db(tag="snapshot")
    if not backup_file or not backup_file.exists():
        raise HTTPException(
            status_code=500,
            detail="Не вдалося створити резервну копію бази даних",
        )

    filename = backup_file.name
    if "snapshot" in filename:
        filename = "reports-snapshot.sql"

    try:
        audit(db, request, user.login, user.role, "завантажено бекап", filename)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not record the backup download in the audit log")

    return FileResponse(
        path=backup_file,
        filename=filename,
        media_type="application/sql",
    )


__all__ = [
    "BACKUP_DIR",
    "EVERY_MIN",
    "KEEP",
    "backup_db",
    "backup_loop",
    "backup_router",
    "download_backup_snapshot",
    "engine",
    "logger",
]
