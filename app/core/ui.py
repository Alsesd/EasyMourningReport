"""UI and Jinja2 templating utilities, flash messages, and redirects."""

from datetime import date
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=TEMPLATES_DIR)


def money(cents: int) -> str:
    return f"{cents / 100:.2f}"


templates.env.filters["money"] = money


def current_period() -> str:
    return date.today().strftime("%Y-%m")


def shift_period(period: str, delta: int) -> str:
    y, m = map(int, period.split("-"))
    n = y * 12 + (m - 1) + delta
    return f"{n // 12:04d}-{n % 12 + 1:02d}"


def flash(request: Request, kind: str, text: str) -> None:
    """One message shown at the top of the next page. kind: 'ok' | 'err' | 'info'."""
    request.session["flash"] = {"kind": kind, "text": text}


def _safe_redirect_target(url: str) -> str:
    """Allow only local absolute-path redirects; fallback to home for unsafe targets."""
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
    flash(request, kind, text)
    return RedirectResponse(_safe_redirect_target(url), 303)


def render(
    request: Request, name: str, ctx: dict | None = None, status_code: int = 200
):
    ctx = dict(ctx or {})
    ctx.setdefault("user", None)
    ctx["flash"] = request.session.pop("flash", None)
    ctx["this_period"] = current_period()
    ctx["nav_period"] = request.session.get("period") or ctx["this_period"]
    if "period" in ctx and "prev_period" not in ctx:
        ctx["prev_period"], ctx["next_period"] = (
            shift_period(ctx["period"], -1),
            shift_period(ctx["period"], 1),
        )
    return templates.TemplateResponse(request, name, ctx, status_code=status_code)


class FormError(Exception):
    """A user mistake in a form: shown as a red message on the page the form was sent from."""

    def __init__(self, message: str, to: str | None = None):
        super().__init__(message)
        self.message, self.to = message, to


def safe_referer(request: Request) -> str | None:
    ref = request.headers.get("referer")
    if not ref:
        return None
    u = urlparse(ref)
    if u.netloc and u.netloc != request.headers.get("host"):
        return None
    return (u.path or "/") + (f"?{u.query}" if u.query else "")
