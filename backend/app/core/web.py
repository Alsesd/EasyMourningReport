"""Minimal server-rendered fallback and redirect helpers used by legacy routes."""

from urllib.parse import urlparse

from fastapi import Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.core.errors import FormError
from app.core.paths import asset_dir
from app.core.periods import current_period, money, shift_period

TEMPLATES_DIR = asset_dir("templates")
templates = Jinja2Templates(directory=TEMPLATES_DIR)
templates.env.filters["money"] = money


def flash(request: Request, kind: str, text: str) -> None:
    """Store a one-time message for the next rendered fallback page."""
    request.session["flash"] = {"kind": kind, "text": text}


def _safe_redirect_target(url: str | None) -> str:
    """Allow only local absolute-path redirects; reject external or relative URLs."""
    if not url:
        return "/"
    normalized = url.replace("\\", "/")
    parsed = urlparse(normalized)
    if parsed.scheme or parsed.netloc or normalized.startswith("//"):
        return "/"
    if not normalized.startswith("/"):
        return "/"
    return normalized


def done(
    request: Request, url: str, text: str, kind: str = "ok"
) -> RedirectResponse:
    """Set a flash message and redirect using a safe local target."""
    flash(request, kind, text)
    return RedirectResponse(_safe_redirect_target(url), 303)


def render(
    request: Request, name: str, ctx: dict | None = None, status_code: int = 200
):
    """Render a small fallback template with period navigation and flash state."""
    context = dict(ctx or {})
    context.setdefault("user", None)
    context["flash"] = request.session.pop("flash", None)
    context["this_period"] = current_period()
    context["nav_period"] = request.session.get("period") or context["this_period"]
    if "period" in context and "prev_period" not in context:
        context["prev_period"], context["next_period"] = (
            shift_period(context["period"], -1),
            shift_period(context["period"], 1),
        )
    return templates.TemplateResponse(request, name, context, status_code=status_code)


def safe_referer(request: Request) -> str | None:
    """Return a same-origin referer as a local path, query included."""
    referer = request.headers.get("referer")
    if not referer:
        return None
    parsed = urlparse(referer)
    if parsed.netloc and parsed.netloc != request.headers.get("host"):
        return None
    return (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")


__all__ = ["FormError", "done", "flash", "render", "safe_referer"]
