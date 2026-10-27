from fastapi import APIRouter, Depends, HTTPException

import app.features.tunnel.service as tunnel_svc
from app.features.auth.dependencies import api_admin_required
from app.features.auth.models import User

router = APIRouter(tags=["Tunnel"])


@router.get("/admin/tunnel")
def get_tunnel_status(
    _: User = Depends(api_admin_required),
) -> dict:
    """Return the tunnel status without credentials."""
    return tunnel_svc.get_status()


@router.post("/admin/tunnel")
def enable_tunnel(
    payload: dict,
    _: User = Depends(api_admin_required),
) -> dict:
    """Start public tunnel after explicit confirmation; never persist auth keys."""
    if payload.get("confirm_public") is not True:
        raise HTTPException(
            status_code=400,
            detail="Підтвердьте, що тунель відкриває застосунок для публічного доступу.",
        )
    auth_key = payload.get("auth_key")
    if auth_key is not None and not isinstance(auth_key, str):
        raise HTTPException(
            status_code=422, detail="Некоректний формат auth key."
        )
    autostart = payload.get("autostart", True)
    if not isinstance(autostart, bool):
        raise HTTPException(
            status_code=422, detail="Некоректне значення автозапуску."
        )
    result = tunnel_svc.start_tunnel(auth_key or None, autostart=autostart)
    if result.get("state") == "error":
        raise HTTPException(
            status_code=503,
            detail=result.get("error") or "Тунель не запустився.",
        )
    return result


@router.put("/admin/tunnel/autostart")
def update_tunnel_autostart(
    payload: dict,
    _: User = Depends(api_admin_required),
) -> dict:
    """Toggle startup autostart without changing the current tunnel session."""
    enabled = payload.get("enabled")
    if not isinstance(enabled, bool):
        raise HTTPException(
            status_code=422, detail="Некоректне значення автозапуску."
        )
    try:
        return tunnel_svc.set_autostart(enabled)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/admin/tunnel")
def disable_tunnel(
    _: User = Depends(api_admin_required),
) -> dict:
    """Disconnect the tunnel helper; the autostart preference remains independent."""
    result = tunnel_svc.stop_tunnel()
    if result.get("state") == "error":
        raise HTTPException(
            status_code=500,
            detail=result.get("error") or "Не вдалося вимкнути тунель.",
        )
    return result


__all__ = ["router"]
