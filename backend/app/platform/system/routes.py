"""Server administration endpoints: database backup download, public tunnel, Tailscale Funnel."""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.core.tailscale import get_status as tailscale_status, set_autostart as set_tailscale_autostart, start_funnel, stop_funnel
from app.core.tunnel import get_status as tunnel_status, set_autostart as set_tunnel_autostart, start_tunnel, stop_tunnel
from app.db.backup import backup_db
from app.db.session import DB_PATH, get_db
from app.platform.accounts.access import Principal, require
from app.platform.accounts.permissions import SYSTEM_MANAGE
from app.platform.audit.service import audit

router = APIRouter(tags=["System"])
logger = logging.getLogger(__name__)


@router.get("/admin/tailscale")
def get_tailscale_status(
    _: Principal = Depends(require(SYSTEM_MANAGE)),
) -> dict:
    """Return the app-specific Tailscale Funnel status without credentials."""
    return tailscale_status()


@router.post("/admin/tailscale")
def enable_tailscale_funnel(
    payload: dict,
    _: Principal = Depends(require(SYSTEM_MANAGE)),
) -> dict:
    """Start the optional public Funnel after explicit confirmation; never persist auth keys."""
    if payload.get("confirm_public") is not True:
        raise HTTPException(
            status_code=400,
            detail="Підтвердьте, що Funnel відкриває застосунок для публічного доступу.",
        )
    auth_key = payload.get("auth_key")
    if auth_key is not None and not isinstance(auth_key, str):
        raise HTTPException(status_code=422, detail="Некоректний формат auth key.")
    autostart = payload.get("autostart", True)
    if not isinstance(autostart, bool):
        raise HTTPException(status_code=422, detail="Некоректне значення автозапуску.")
    result = start_funnel(auth_key or None, autostart=autostart)
    if result.get("state") == "error":
        raise HTTPException(status_code=503, detail=result.get("error") or "Tailscale не запустився.")
    return result


@router.put("/admin/tailscale/autostart")
def update_tailscale_autostart(
    payload: dict,
    _: Principal = Depends(require(SYSTEM_MANAGE)),
) -> dict:
    """Toggle startup autostart without changing the current Funnel session."""
    enabled = payload.get("enabled")
    if not isinstance(enabled, bool):
        raise HTTPException(status_code=422, detail="Некоректне значення автозапуску.")
    try:
        return set_tailscale_autostart(enabled)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/admin/tailscale")
def disable_tailscale_funnel(
    _: Principal = Depends(require(SYSTEM_MANAGE)),
) -> dict:
    """Disconnect the live helper; the autostart preference remains independent."""
    result = stop_funnel()
    if result.get("state") == "error":
        raise HTTPException(status_code=500, detail=result.get("error") or "Не вдалося вимкнути Funnel.")
    return result


@router.get("/admin/tunnel")
def get_tunnel_status(
    _: Principal = Depends(require(SYSTEM_MANAGE)),
) -> dict:
    """Return the tunnel status without credentials."""
    return tunnel_status()


@router.post("/admin/tunnel")
def enable_tunnel(
    payload: dict,
    _: Principal = Depends(require(SYSTEM_MANAGE)),
) -> dict:
    """Start public tunnel after explicit confirmation; never persist auth keys."""
    if payload.get("confirm_public") is not True:
        raise HTTPException(
            status_code=400,
            detail="Підтвердьте, що тунель відкриває застосунок для публічного доступу.",
        )
    auth_key = payload.get("auth_key")
    if auth_key is not None and not isinstance(auth_key, str):
        raise HTTPException(status_code=422, detail="Некоректний формат auth key.")
    autostart = payload.get("autostart", True)
    if not isinstance(autostart, bool):
        raise HTTPException(status_code=422, detail="Некоректне значення автозапуску.")
    result = start_tunnel(auth_key or None, autostart=autostart)
    if result.get("state") == "error":
        raise HTTPException(status_code=503, detail=result.get("error") or "Тунель не запустився.")
    return result


@router.put("/admin/tunnel/autostart")
def update_tunnel_autostart(
    payload: dict,
    _: Principal = Depends(require(SYSTEM_MANAGE)),
) -> dict:
    """Toggle startup autostart without changing the current tunnel session."""
    enabled = payload.get("enabled")
    if not isinstance(enabled, bool):
        raise HTTPException(status_code=422, detail="Некоректне значення автозапуску.")
    try:
        return set_tunnel_autostart(enabled)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/admin/tunnel")
def disable_tunnel(
    _: Principal = Depends(require(SYSTEM_MANAGE)),
) -> dict:
    """Disconnect the tunnel helper; the autostart preference remains independent."""
    result = stop_tunnel()
    if result.get("state") == "error":
        raise HTTPException(status_code=500, detail=result.get("error") or "Не вдалося вимкнути тунель.")
    return result


@router.get("/admin/backup/download")
def download_backup_snapshot(
    request: Request,
    principal: Principal = Depends(require(SYSTEM_MANAGE)),
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
        audit(db, request, principal.login, principal.role_label, "завантажено бекап", filename)
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
