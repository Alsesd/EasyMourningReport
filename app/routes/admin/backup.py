"""Admin backup snapshot download endpoint."""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core import admin_required, get_db
from app.db import DB_PATH, User, audit, backup_db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/download")
def download_backup_snapshot(
    request: Request,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    """Generate an on-demand live SQLite backup snapshot and stream it as an attachment."""
    backup_file: Path | None = backup_db(tag="snapshot")
    if not backup_file or not backup_file.exists():
        if DB_PATH.exists():
            backup_file = DB_PATH
        else:
            raise HTTPException(
                status_code=500,
                detail="Не вдалося створити резервну копію бази даних",
            )

    filename = backup_file.name
    try:
        audit(db, request, user.login, user.role, "завантажено бекап", filename)
        db.commit()
    except Exception:
        # A logging failure must not turn a successfully created backup into a failed download.
        db.rollback()
        logger.exception("Could not record the backup download in the audit log")

    return FileResponse(
        path=backup_file,
        filename=filename,
        media_type="application/octet-stream",
    )


# Alias for backward compatibility
backup_download = download_backup_snapshot

__all__ = ["backup_download", "download_backup_snapshot", "router"]
