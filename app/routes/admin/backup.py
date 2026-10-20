"""Admin backup snapshot download endpoint."""
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.core.dependencies import admin_required
from app.db.backup import backup_db
from app.db.models.user import User
from app.db.repositories.audit import audit
from app.db.session import DB_PATH, engine, get_db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/download")
def download_backup_snapshot(
    request: Request,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    """Download a local SQLite snapshot; remote DB backups belong to the DB provider."""
    if engine.dialect.name != "sqlite":
        raise HTTPException(
            status_code=501,
            detail="Резервні копії віддаленої бази створюються у провайдера PostgreSQL.",
        )
    backup_file: Path | None = backup_db(tag="snapshot")
    if not backup_file or not backup_file.exists():
        if DB_PATH.exists():
            backup_file = DB_PATH
        else:
            raise HTTPException(status_code=500, detail="Не вдалося створити резервну копію бази даних")

    filename = backup_file.name
    try:
        audit(db, request, user.login, user.role, "завантажено бекап", filename)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not record the backup download in the audit log")
    return FileResponse(path=backup_file, filename=filename, media_type="application/octet-stream")


backup_download = download_backup_snapshot
__all__ = ["backup_download", "download_backup_snapshot", "router"]
