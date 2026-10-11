import asyncio
import os
import re
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

import uvicorn
from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

from .backup import backup_db, backup_loop
from .bootstrap import migrate, seed
from .models import AuditLog, Product, ProductPrice, Report, ReportItem, SessionLocal, User
from .pricing import (BASE_PERIOD, History, apply_price_change, latest_price, norm_login, norm_name,
                      offered_prices, same_name, valid_login)
from .ratelimit import clear_failures, record_failure, retry_after
from .reporting import build_lines, build_summary, history_of, in_form, load_history, report_total
from .security import check_pw, client_ip, hash_pw, load_secret, same_origin_post_guard

ACTIONS = ["вхід", "невдалий вхід", "вихід", "збережено звіт", "надіслано звіт",
           "додано товар", "змінено товар", "змінено ціну товару", "архівовано товар", "відновлено товар",
           "видалено товар",
           "додано магазин", "змінено магазин", "архівовано магазин", "відновлено магазин", "видалено магазин",
           "змінено пароль магазину", "змінено пароль адміністратора",
           "заблоковано звіт", "розблоковано звіт"]


def money(cents: int) -> str:
    return f"{cents / 100:.2f}"


def audit(db: Session, request: Request, login: str, role: str, action: str, detail: str = "") -> None:
    """Append one row to the admin-visible action log."""
    db.add(AuditLog(login=login, role=role, action=action, detail=detail, ip=client_ip(request)))


@asynccontextmanager
async def lifespan(_: FastAPI):
    migrate()
    seed()
    await asyncio.to_thread(backup_db)
    task = asyncio.create_task(backup_loop())
    yield
    task.cancel()
    backup_db()


app = FastAPI(lifespan=lifespan)


app.add_middleware(SessionMiddleware, secret_key=load_secret(), https_only=os.getenv("COOKIE_SECURE") == "1",
                   max_age=7 * 24 * 3600)
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")


templates.env.filters["money"] = money

# ---------- installable app (PWA) ----------
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/offline")
def offline(request: Request):
    return render(request, "offline.html")


# ---------- pages, flash messages, errors ----------
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
    if parsed.scheme or parsed.netloc:
        return "/"
    if not normalized.startswith("/"):
        return "/"
    return normalized


def done(request: Request, url: str, text: str, kind: str = "ok") -> RedirectResponse:
    flash(request, kind, text)
    return RedirectResponse(_safe_redirect_target(url), 303)


def render(request: Request, name: str, ctx: dict | None = None, status_code: int = 200):
    ctx = dict(ctx or {})
    ctx.setdefault("user", None)
    ctx["flash"] = request.session.pop("flash", None)
    ctx["this_period"] = current_period()
    ctx["nav_period"] = request.session.get("period") or ctx["this_period"]
    if "period" in ctx and "prev_period" not in ctx:
        ctx["prev_period"], ctx["next_period"] = shift_period(ctx["period"], -1), shift_period(ctx["period"], 1)
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


@app.exception_handler(FormError)
def form_error(request: Request, exc: FormError):
    return done(request, exc.to or safe_referer(request) or "/", exc.message, "err")


@app.exception_handler(RequestValidationError)
def invalid_form(request: Request, exc: RequestValidationError):
    if request.method == "POST":  # an empty or missing form field: say so on the page the form was sent from
        return done(request, safe_referer(request) or "/", "Заповніть усі поля форми.", "err")
    return render(request, "error.html", {"code": 400, "message": "Некоректний запит"}, status_code=400)


@app.exception_handler(StarletteHTTPException)
def http_error(request: Request, exc: StarletteHTTPException):
    location = (exc.headers or {}).get("Location")
    if location and 300 <= exc.status_code < 400:
        return RedirectResponse(location, exc.status_code)
    return render(request, "error.html", {"code": exc.status_code, "message": exc.detail}, status_code=exc.status_code)


def get_db():
    with SessionLocal() as db:
        yield db


def user_required(request: Request, db: Session = Depends(get_db)) -> User:
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user and user.role == "store" and (not user.store or user.store.archived):
        user = None  # archived store: the login no longer works
    if not user:
        raise HTTPException(303, headers={"Location": "/login"})
    return user


def admin_required(user: User = Depends(user_required)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Лише для адміністраторів")
    return user


def store_required(user: User = Depends(user_required)) -> User:
    if user.role != "store":
        raise HTTPException(403, "Лише для користувачів магазинів")
    return user


def parse_period(p: str | None) -> str:
    p = p or current_period()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", p):
        raise HTTPException(400, "Період має мати вигляд 2026-10")
    return p


def admin_period(request: Request, p: str | None) -> str:
    """Month for admin pages. An explicit choice is remembered, so the tabs keep showing the same month."""
    if p:
        period = parse_period(p)
        request.session["period"] = period
        return period
    return parse_period(request.session.get("period"))


def to_cents(s: str) -> int:
    try:
        d = Decimal(s.strip().replace(" ", "").replace(",", "."))
        if not d.is_finite():
            raise InvalidOperation
        cents = int((d * 100).to_integral_value())
    except (InvalidOperation, ValueError):
        raise FormError("Некоректна ціна. Приклад: 25.50")
    if cents < 0 or cents > 1_000_000_000:
        raise FormError("Некоректна ціна. Приклад: 25.50")
    return cents


def clean_name(raw: str, what: str = "Назва") -> str:
    name = norm_name(raw)
    if not name:
        raise FormError(f"{what} не може бути порожньою")
    if len(name) > 100:
        raise FormError(f"{what} задовга (до 100 символів)")
    return name


def clean_login(raw: str) -> str:
    login = norm_login(raw)
    if not valid_login(login):
        raise FormError("Логін: від 2 до 40 символів, без пробілів")
    return login


def new_password(pw: str) -> str:
    if len(pw) < 6:
        raise FormError("Пароль має бути щонайменше 6 символів")
    return pw


# ---------- auth ----------
@app.get("/login")
def login_form(request: Request):
    return render(request, "login.html", {"error": None})


@app.post("/login")
def login_post(request: Request, login: str = Form(), password: str = Form(), db: Session = Depends(get_db)):
    key = norm_login(login)
    ip = client_ip(request)
    wait = retry_after(ip, key)
    if wait:
        return Response(
            "Забагато невдалих спроб. Спробуйте пізніше.", status_code=429,
            headers={"Retry-After": str(wait), "Cache-Control": "no-store"},
        )
    user = db.scalar(select(User).where(User.login == key))
    if not user or not check_pw(password, user.password_hash):
        record_failure(ip, key)
        audit(db, request, key or "?", "", "невдалий вхід")
        db.commit()
        return render(request, "login.html", {"error": "Неправильний логін або пароль"}, status_code=401)
    if user.role == "store" and (not user.store or user.store.archived):
        record_failure(ip, key)
        audit(db, request, user.login, user.role, "невдалий вхід", "магазин в архіві")
        db.commit()
        return render(request, "login.html",
                      {"error": "Цей обліковий запис вимкнено. Зверніться до адміністратора."}, status_code=403)
    clear_failures(ip, key)
    audit(db, request, user.login, user.role, "вхід")
    db.commit()
    request.session.clear()
    request.session["uid"] = user.id
    return RedirectResponse("/", 303)


@app.post("/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user:
        audit(db, request, user.login, user.role, "вихід")
        db.commit()
    request.session.clear()
    return RedirectResponse("/login", 303)


@app.get("/")
def index(user: User = Depends(user_required)):
    return RedirectResponse("/admin" if user.role == "admin" else "/report", 303)


# ---------- prices and report lines ----------
def save_history(db: Session, pid: int, new: History) -> None:
    rows = {r.period: r for r in db.scalars(select(ProductPrice).where(ProductPrice.product_id == pid))}
    wanted = dict(new)
    for period, row in rows.items():
        if period in wanted:
            row.price_cents = wanted[period]
        else:
            db.delete(row)
    for period, cents in wanted.items():
        if period not in rows:
            db.add(ProductPrice(product_id=pid, period=period, price_cents=cents))


# ---------- store: monthly report (quantities only) ----------# ---------- store: monthly report (quantities only) ----------
def store_periods(db: Session, store_id: int) -> set[str]:
    return set(db.scalars(select(Report.period).where(Report.store_id == store_id)))


def find_report(db: Session, store_id: int, period: str) -> Report | None:
    return db.scalar(select(Report).where(Report.store_id == store_id, Report.period == period))


@app.get("/report")
def report_page(request: Request, period: str | None = None, user: User = Depends(store_required),
                db: Session = Depends(get_db)):
    period = parse_period(period)
    current = current_period()
    known = store_periods(db, user.store_id)
    if period != current and period not in known:
        return done(request, "/report", f"Звіту за {period} немає. Можна відкрити поточний місяць "
                    "або місяці, за які вже подано звіти.", "err")
    report = find_report(db, user.store_id, period)
    rows, inactive, inactive_total = build_lines(db, period, report.items if report else [])
    allowed = sorted(known | {current})
    ctx = {"user": user, "period": period, "rows": rows, "inactive_rows": inactive, "inactive_total": inactive_total,
           "total": sum(r["sum"] for r in rows) + inactive_total,
           "status": report.status if report else "new",
           "min_period": allowed[0], "max_period": allowed[-1],
           "prev_period": max((x for x in allowed if x < period), default=None),
           "next_period": min((x for x in allowed if x > period), default=None)}
    return render(request, "report.html", ctx)


@app.post("/report")
async def report_save(request: Request, user: User = Depends(store_required), db: Session = Depends(get_db)):
    form = await request.form()
    period = parse_period(form.get("period"))
    here = f"/report?period={period}"
    if period != current_period() and period not in store_periods(db, user.store_id):
        raise HTTPException(403, "Звіту за цей місяць не існує")
    report = find_report(db, user.store_id, period)
    if report and report.status == "submitted":
        raise FormError("Цей звіт надіслано й заблоковано. Попросіть адміністратора розблокувати його.", here)
    if not report:
        report = Report(store_id=user.store_id, period=period, status="draft")
        db.add(report)

    # Which (product, price) lines this report may contain: the prices offered for this month, plus prices that
    # are already saved in it. The server decides - a price coming from the browser is never trusted.
    history = load_history(db)
    allowed: dict[int, set[int]] = {}
    for p in db.scalars(select(Product).where(Product.active, Product.archived.is_(False))):
        allowed[p.id] = set(offered_prices(history_of(history, p), period))
    for it in report.items:
        if it.product_id in allowed and it.quantity > 0:
            allowed[it.product_id].add(it.unit_price_cents)

    submitted: dict[int, dict[int, int]] = defaultdict(dict)
    for field, raw in form.multi_items():
        m = re.fullmatch(r"qty_(\d+)_(\d+)", str(field))
        if not m:
            continue
        pid, price_cents = int(m.group(1)), int(m.group(2))
        try:
            qty = int(str(raw).strip() or 0)
        except ValueError:
            raise FormError("Кількість має бути цілим числом", here)
        if qty < 0:
            raise FormError("Кількість не може бути від'ємною", here)
        if not qty:
            continue
        if price_cents not in allowed.get(pid, ()):
            raise FormError("Список товарів або ціни змінилися, поки ви редагували звіт. Нічого не збережено: "
                            "перевірте кількості на оновленій сторінці й збережіть ще раз.", here)
        submitted[pid][price_cents] = qty
    for pid in allowed:
        if any(i.product_id == pid for i in report.items) or submitted.get(pid):
            report.items = [i for i in report.items if i.product_id != pid]
            for price_cents, qty in submitted.get(pid, {}).items():
                report.items.append(ReportItem(product_id=pid, quantity=qty, unit_price_cents=price_cents))

    submitting = form.get("action") == "submit"
    if submitting:
        report.status = "submitted"
    audit(db, request, user.login, user.role, "надіслано звіт" if submitting else "збережено звіт",
          f"{user.store.name} · {period}")
    db.commit()
    if submitting:
        return done(request, here, "Звіт надіслано й заблоковано. Змінити його може лише адміністратор: "
                    "він має розблокувати звіт.")
    return done(request, here, "Чернетку збережено. Звіт ще не надіслано, його можна редагувати далі.")


from .admin_routes import register_admin_routes

register_admin_routes(app, {
    "ACTIONS": ACTIONS,
    "BASE_PERIOD": BASE_PERIOD,
    "admin_period": admin_period,
    "admin_required": admin_required,
    "apply_price_change": apply_price_change,
    "audit": audit,
    "backup_db": backup_db,
    "build_lines": build_lines,
    "build_summary": build_summary,
    "clean_login": clean_login,
    "clean_name": clean_name,
    "current_period": current_period,
    "done": done,
    "FormError": FormError,
    "get_db": get_db,
    "hash_pw": hash_pw,
    "history_of": history_of,
    "in_form": in_form,
    "latest_price": latest_price,
    "load_history": load_history,
    "money": money,
    "new_password": new_password,
    "norm_login": norm_login,
    "norm_name": norm_name,
    "offered_prices": offered_prices,
    "parse_period": parse_period,
    "render": render,
    "report_total": report_total,
    "same_name": same_name,
    "save_history": save_history,
    "to_cents": to_cents,
    "valid_login": valid_login
})


if __name__ == "__main__":  # also the entry point for the compiled exe (Nuitka)
    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))
