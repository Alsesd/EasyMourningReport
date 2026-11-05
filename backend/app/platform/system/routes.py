"""Server administration: public tunnel, database backups and health."""

import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.db.backup import backup_db, list_backups
from app.db.session import get_db
from app.platform.accounts.access import Principal, require
from app.platform.accounts.permissions import SYSTEM_MANAGE
from app.platform.audit.service import audit
import app.platform.system.tunnel as tunnel
from app.platform.system.health import health
from app.platform.system.schemas import (
    BackupDTO,
    SystemHealthDTO,
    TunnelAutostartDTO,
    TunnelStartDTO,
    TunnelStatusDTO,
)

router = APIRouter(tags=["System"])
logger = logging.getLogger(__name__)
manage = Depends(require(SYSTEM_MANAGE))


def _checked(result: dict, fallback: str, code: int = 500) -> TunnelStatusDTO:
    if result.get("state") == "error":
        raise HTTPException(status_code=code, detail=result.get("error") or fallback)
    return TunnelStatusDTO(**result)


@router.get("/admin/tunnel", response_model=TunnelStatusDTO)
def get_tunnel(_: Principal = manage) -> TunnelStatusDTO:
    return TunnelStatusDTO(**tunnel.status())


@router.post("/admin/tunnel", response_model=TunnelStatusDTO)
def start_tunnel(payload: TunnelStartDTO, request: Request, principal: Principal = manage,
                 db: Session = Depends(get_db)) -> TunnelStatusDTO:
    """Open public access after explicit confirmation. A supplied token is stored, never returned."""
    if not payload.confirm_public:
        raise HTTPException(status_code=400, detail="Підтвердьте, що тунель відкриває застосунок для публічного доступу.")
    result = _checked(tunnel.start(payload.token, autostart=payload.autostart), "Тунель не запустився.", 503)
    audit(db, request, principal.login, principal.role_label, "увімкнено публічний доступ",
          "новий токен" if payload.token else "")
    db.commit()
    return result


@router.put("/admin/tunnel/autostart", response_model=TunnelStatusDTO)
def set_tunnel_autostart(payload: TunnelAutostartDTO, _: Principal = manage) -> TunnelStatusDTO:
    return TunnelStatusDTO(**tunnel.set_autostart(payload.enabled))


@router.delete("/admin/tunnel", response_model=TunnelStatusDTO)
def stop_tunnel(request: Request, principal: Principal = manage, db: Session = Depends(get_db)) -> TunnelStatusDTO:
    result = TunnelStatusDTO(**tunnel.stop())
    audit(db, request, principal.login, principal.role_label, "вимкнено публічний доступ")
    db.commit()
    return result


def _backup_dto(path: Path) -> BackupDTO:
    stat = path.stat()
    return BackupDTO(
        name=path.name,
        size_bytes=stat.st_size,
        created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
    )


@router.get("/admin/backups", response_model=list[BackupDTO])
def get_backups(limit: int = 20, _: Principal = manage) -> list[BackupDTO]:
    return [_backup_dto(p) for p in list_backups()[: max(1, min(limit, 200))]]


@router.get("/admin/system/health", response_model=SystemHealthDTO)
def get_health(_: Principal = manage) -> SystemHealthDTO:
    return health()


@router.get("/admin/backup/download")
def download_backup_snapshot(
    request: Request,
    principal: Principal = manage,
    db: Session = Depends(get_db),
):
    """Take a fresh, verified snapshot and stream it as an attachment."""
    try:
        backup_file = backup_db(tag="snapshot")
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not backup_file or not backup_file.exists():
        raise HTTPException(status_code=500, detail="Не вдалося створити резервну копію бази даних")
    try:
        audit(db, request, principal.login, principal.role_label, "завантажено бекап", backup_file.name)
        db.commit()
    except Exception:
        # A logging failure must not turn a successfully created backup into a failed download.
        db.rollback()
        logger.exception("Could not record the backup download in the audit log")
    return FileResponse(path=backup_file, filename=backup_file.name, media_type="application/octet-stream")

