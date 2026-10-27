"""PostgreSQL backup utility, background loop, and snapshot download router."""

import asyncio
import hashlib
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
from app.features.auth.dependencies import api_admin_required
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


def _get_mirror_dir() -> Path | None:
    env_dir = (
        os.getenv("LEGKYI_BACKUP_MIRROR_DIR")
        or os.getenv("BACKUPS_MIRROR_DIR")
        or os.getenv("BACKUP_MIRROR_DIR")
    )
    if not env_dir:
        return None
    return Path(env_dir.strip("\"'")).expanduser().resolve()


BACKUP_DIR = _get_backup_dir()
MIRROR_DIR = _get_mirror_dir()
KEEP = max(1, int(os.getenv("BACKUP_KEEP", "100")))
EVERY_MIN = int(os.getenv("BACKUP_EVERY_MIN", "60"))


def _checksum_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.sha256")


def _write_checksum(path: Path) -> None:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    _checksum_path(path).write_text(
        f"{digest}  {path.name}\n", encoding="utf-8"
    )


def _prune(directory: Path) -> None:
    for old in sorted(directory.glob("reports-*.sql"))[:-KEEP]:
        for candidate in (old, _checksum_path(old)):
            try:
                candidate.unlink(missing_ok=True)
            except OSError:
                pass


def _mirror_backup(source: Path) -> None:
    """Copy a verified snapshot to the independent backup location."""
    if MIRROR_DIR is None:
        return
    if MIRROR_DIR == BACKUP_DIR:
        return
    temporary: Path | None = None
    try:
        MIRROR_DIR.mkdir(parents=True, exist_ok=True)
        destination = MIRROR_DIR / source.name
        temporary = destination.with_name(f"{destination.name}.tmp")
        shutil.copy2(source, temporary)
        temporary.replace(destination)
        _write_checksum(destination)
        _prune(MIRROR_DIR)
    except OSError:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        logger.exception("Could not mirror database backup to %s", MIRROR_DIR)


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

    _write_checksum(dest)
    _mirror_backup(dest)
    _prune(active_backup_dir)
    return dest


async def backup_loop():
    while True:
        await asyncio.sleep(EVERY_MIN * 60)
        await asyncio.to_thread(backup_db)


backup_router = APIRouter()


@backup_router.get("/admin/backup/download")
def download_backup_snapshot(
    request: Request,
    user: User = Depends(api_admin_required),
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
    "MIRROR_DIR",
    "backup_db",
    "backup_loop",
    "backup_router",
    "download_backup_snapshot",
    "engine",
    "logger",
]
