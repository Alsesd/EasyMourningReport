"""Admin controls for the optional public Tailscale Funnel."""

from fastapi import APIRouter, Form, Request

from app.core.tailscale import start_funnel, stop_funnel
from app.core.ui import done

router = APIRouter()


@router.post("/enable")
def enable_public_funnel(
    request: Request,
    confirm_public: str = Form(default=""),
    auth_key: str = Form(default=""),
):
    """Start public Funnel only after explicit confirmation in the admin UI."""
    if confirm_public != "yes":
        return done(
            request,
            "/admin#tailscale",
            "Підтвердьте, що розумієте: Funnel відкриває застосунок для публічного доступу.",
            "err",
        )
    result = start_funnel(auth_key or None)
    if result.get("state") == "error":
        message = f"Не вдалося запустити Tailscale Funnel: {result['error']}"
        return done(request, "/admin#tailscale", message, "err")
    return done(
        request,
        "/admin#tailscale",
        "Запущено спробу підключення Tailscale. Перевірте статус і посилання для входу нижче.",
    )


@router.post("/disable")
def disable_public_funnel(request: Request):
    """Disconnect the current helper while preserving the autostart preference."""
    result = stop_funnel()
    if result.get("state") == "error":
        return done(request, "/admin#tailscale", result["error"], "err")
    return done(request, "/admin#tailscale", "Tailscale Funnel відключено. Налаштування автозапуску збережено.")
