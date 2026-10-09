import asyncio
import csv
import hashlib
import hmac
import io
import os
import re
import secrets
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from .backup import backup_db, backup_loop
from .models import (DB_PATH, AuditLog, Base, Product, Report, ReportItem, SessionLocal, Store, User, engine)

ACTIONS = ["вхід", "невдалий вхід", "вихід", "збережено звіт", "надіслано звіт",
           "додано товар", "змінено товар", "видалено товар", "додано магазин", "видалено магазин",
           "змінено пароль магазину", "змінено пароль адміністратора",
           "заблоковано звіт", "розблоковано звіт"]


def money(cents: int) -> str:
    return f"{cents / 100:.2f}"


def hash_pw(pw: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    return salt.hex() + "$" + hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000).hex()


def check_pw(pw: str, stored: str) -> bool:
    return hmac.compare_digest(hash_pw(pw, bytes.fromhex(stored.split("$")[0])), stored)


def audit(db: Session, request: Request, login: str, role: str, action: str, detail: str = "") -> None:
    """Append one row to the admin-visible action log."""
    db.add(AuditLog(login=login, role=role, action=action, detail=detail, ip=client_ip(request)))


def seed():
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)):
            return
        admin_pw = os.getenv("ADMIN_PASSWORD") or secrets.token_urlsafe(9)
        db.add(User(login="admin", password_hash=hash_pw(admin_pw), role="admin"))
        print(f"\n*** ПЕРШИЙ ЗАПУСК: логін 'admin', пароль '{admin_pw}'. Змініть його на сторінці «Налаштування». ***\n", flush=True)
        if not os.getenv("DEMO"):
            db.commit()
            return
        db.add_all([
            Product(name="Яблука, кг", price_cents=250),
            Product(name="Хліб", price_cents=120),
            Product(name="Молоко, 1 л", price_cents=95),
        ])
        for n in (1, 2):
            s = Store(name=f"Магазин {n}")
            db.add(s)
            db.flush()
            db.add(User(login=f"store{n}", password_hash=hash_pw(f"store{n}"), role="store", store_id=s.id))
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with engine.begin() as c:  # tiny migration for databases created before the lock feature
        cols = [r[1] for r in c.exec_driver_sql("PRAGMA table_info(reports)")]
        if "status" not in cols:
            c.exec_driver_sql("ALTER TABLE reports ADD COLUMN status VARCHAR NOT NULL DEFAULT 'draft'")
    seed()
    await asyncio.to_thread(backup_db)
    task = asyncio.create_task(backup_loop())
    yield
    task.cancel()
    backup_db()


app = FastAPI(lifespan=lifespan)


def load_secret() -> str:
    if os.getenv("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = DB_PATH.parent / "secret.key"  # generated once, kept next to the database/exe
    if not path.exists():
        path.write_text(secrets.token_hex(32))
    return path.read_text().strip()


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
    return templates.TemplateResponse(request, "offline.html", {"user": None})


def get_db():
    with SessionLocal() as db:
        yield db


def user_required(request: Request, db: Session = Depends(get_db)) -> User:
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
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
    p = p or date.today().strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", p):
        raise HTTPException(400, "Період має мати вигляд 2026-10")
    return p


def to_cents(s: str) -> int:
    try:
        cents = int((Decimal(s.replace(",", ".")) * 100).to_integral_value())
    except InvalidOperation:
        raise HTTPException(400, "Некоректна ціна")
    if cents < 0:
        raise HTTPException(400, "Некоректна ціна")
    return cents


def client_ip(request: Request) -> str:
    host = request.client.host if request.client else "?"
    if host in ("127.0.0.1", "::1"):  # behind the local Funnel proxy: use the forwarded address if present
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return host


# ---------- auth ----------
@app.get("/login")
def login_form(request: Request):
    return templates.TemplateResponse(request, "login.html", {"user": None, "error": None})


@app.post("/login")
def login_post(request: Request, login: str = Form(), password: str = Form(), db: Session = Depends(get_db)):
    key = login.strip().lower()
    user = db.scalar(select(User).where(User.login == key))
    if not user or not check_pw(password, user.password_hash):
        audit(db, request, key or "?", "", "невдалий вхід")
        db.commit()
        return templates.TemplateResponse(
            request, "login.html", {"user": None, "error": "Неправильний логін або пароль"}, status_code=401
        )
    audit(db, request, user.login, user.role, "вхід")
    db.commit()
    request.session.clear()
    request.session["uid"] = user.id
    return RedirectResponse("/", 303)


@app.get("/logout")
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


# ---------- store: monthly report (quantities only, revaluation-aware) ----------
def store_periods(db: Session, store_id: int) -> set[str]:
    return set(db.scalars(select(Report.period).where(Report.store_id == store_id)))


def find_report(db: Session, store_id: int, period: str) -> Report | None:
    return db.scalar(select(Report).where(Report.store_id == store_id, Report.period == period))


@app.get("/report")
def report_page(request: Request, period: str | None = None, user: User = Depends(store_required),
                db: Session = Depends(get_db)):
    period = parse_period(period)
    current = date.today().strftime("%Y-%m")
    known = store_periods(db, user.store_id)
    if period != current and period not in known:
        return RedirectResponse(f"/report?missing={period}", 303)
    report = find_report(db, user.store_id, period)
    saved: dict[int, list[ReportItem]] = defaultdict(list)
    for i in (report.items if report else []):
        saved[i.product_id].append(i)
    rows, total = [], 0
    for p in db.scalars(select(Product).where(Product.active).order_by(Product.name)):
        # Revaluation: current price + every price already saved for this report
        # (admin changed the price mid-month -> two lines: old price / new price).
        prices: dict[int, int] = {p.price_cents: 0}
        for it in saved.get(p.id, []):
            prices[it.unit_price_cents] = it.quantity
        s = sum(q * pr for pr, q in prices.items())
        total += s
        rows.append({"id": p.id, "name": p.name,
                     "inputs": [{"price": pr, "qty": q} for pr, q in sorted(prices.items())], "sum": s})
    inactive_rows = []
    if report:
        active_ids = {p.id for p in db.scalars(select(Product).where(Product.active))}
        by_pid: dict[int, list[ReportItem]] = defaultdict(list)
        for it in report.items:
            if it.product_id not in active_ids and it.quantity > 0:
                by_pid[it.product_id].append(it)
        for pid, items in sorted(by_pid.items(),
                                 key=lambda kv: kv[1][0].product.name if kv[1][0].product else str(kv[0])):
            name = items[0].product.name if items[0].product else f"Товар №{pid}"
            lines = "; ".join(f"{i.quantity} × {money(i.unit_price_cents)}"
                              for i in sorted(items, key=lambda i: i.unit_price_cents))
            inactive_rows.append({"name": name, "lines": lines,
                                  "sum": sum(i.quantity * i.unit_price_cents for i in items)})
    ctx = {"user": user, "period": period, "rows": rows, "total": total, "inactive_rows": inactive_rows,
           "saved": "saved" in request.query_params,
           "status": report.status if report else "new",
           "min_period": min(known | {current}), "max_period": current,
           "missing": request.query_params.get("missing")}
    return templates.TemplateResponse(request, "report.html", ctx)


@app.post("/report")
async def report_save(request: Request, user: User = Depends(store_required), db: Session = Depends(get_db)):
    form = await request.form()
    period = parse_period(form.get("period"))
    if period != date.today().strftime("%Y-%m") and period not in store_periods(db, user.store_id):
        raise HTTPException(403, "Звіту за цей місяць не існує")
    report = find_report(db, user.store_id, period)
    if report and report.status == "submitted":
        raise HTTPException(409, "Цей звіт надіслано й заблоковано. Попросіть адміністратора розблокувати його.")
    if not report:
        report = Report(store_id=user.store_id, period=period, status="draft")
        db.add(report)
    # Collect qty_<product_id>_<price_cents> inputs; one product may arrive with
    # several prices (revaluation within the month).
    submitted: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for field, raw in form.multi_items():
        m = re.fullmatch(r"qty_(\d+)_(\d+)", str(field))
        if not m:
            continue
        pid, price_cents = int(m.group(1)), int(m.group(2))
        try:
            qty = int(str(raw) or 0)
        except ValueError:
            raise HTTPException(400, "Кількість має бути цілим числом")
        if qty < 0:
            raise HTTPException(400, "Кількість не може бути від'ємною")
        if price_cents < 0:
            raise HTTPException(400, "Некоректна ціна")
        if qty:
            submitted[pid].append((price_cents, qty))
    active_ids = {p.id for p in db.scalars(select(Product).where(Product.active))}
    for pid in active_ids:
        had_items = any(i.product_id == pid for i in report.items)
        entries = submitted.get(pid)
        if not had_items and not entries:
            continue
        report.items = [i for i in report.items if i.product_id != pid]
        for price_cents, qty in entries or []:
            report.items.append(ReportItem(product_id=pid, quantity=qty, unit_price_cents=price_cents))
    submitted_now = form.get("action") == "submit"
    if submitted_now:
        report.status = "submitted"
    audit(db, request, user.login, user.role,
          "надіслано звіт" if submitted_now else "збережено звіт",
          f"{report.store.name if report.store else user.store_id} · {period}")
    db.commit()
    return RedirectResponse(f"/report?period={period}&saved=1", 303)


# ---------- admin: products, stores ----------
@app.get("/admin")
def admin_page(request: Request, user: User = Depends(admin_required), db: Session = Depends(get_db)):
    ctx = {
        "user": user,
        "pw": "pw" in request.query_params,
        "products": db.scalars(select(Product).order_by(Product.name)).all(),
        "store_users": db.scalars(select(User).where(User.role == "store").order_by(User.login)).all(),
    }
    return templates.TemplateResponse(request, "admin.html", ctx)


@app.post("/admin/products")
def product_add(request: Request, name: str = Form(), price: str = Form(), user: User = Depends(admin_required),
                db: Session = Depends(get_db)):
    p = Product(name=name.strip(), price_cents=to_cents(price))
    db.add(p)
    audit(db, request, user.login, user.role, "додано товар", f"{p.name} · {money(p.price_cents)}")
    db.commit()
    return RedirectResponse("/admin", 303)


@app.post("/admin/products/{pid}")
def product_edit(request: Request, pid: int, name: str = Form(), price: str = Form(), active: str | None = Form(None),
                 user: User = Depends(admin_required), db: Session = Depends(get_db)):
    p = db.get(Product, pid)
    if not p:
        raise HTTPException(404)
    p.name, p.price_cents, p.active = name.strip(), to_cents(price), active is not None
    audit(db, request, user.login, user.role, "змінено товар",
          f"{p.name} · {money(p.price_cents)}{' · неактивний' if not p.active else ''}")
    db.commit()
    return RedirectResponse("/admin", 303)


@app.post("/admin/stores")
def store_add(request: Request, name: str = Form(), login: str = Form(), password: str = Form(),
              user: User = Depends(admin_required), db: Session = Depends(get_db)):
    store = Store(name=name.strip())
    db.add(store)
    try:
        db.flush()
        db.add(User(login=login.strip(), password_hash=hash_pw(new_password(password)), role="store", store_id=store.id))
        audit(db, request, user.login, user.role, "додано магазин", f"{store.name} · логін {login.strip()}")
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Магазин із такою назвою або логін уже існує")
    return RedirectResponse("/admin", 303)


@app.post("/admin/products/{pid}/delete")
def product_delete(request: Request, pid: int, user: User = Depends(admin_required), db: Session = Depends(get_db)):
    p = db.get(Product, pid)
    backup_db("before-delete")
    db.execute(delete(ReportItem).where(ReportItem.product_id == pid))
    db.execute(delete(Product).where(Product.id == pid))
    audit(db, request, user.login, user.role, "видалено товар", p.name if p else f"№{pid}")
    db.commit()
    return RedirectResponse("/admin", 303)


@app.post("/admin/stores/{sid}/delete")
def store_delete(request: Request, sid: int, user: User = Depends(admin_required), db: Session = Depends(get_db)):
    s = db.get(Store, sid)
    backup_db("before-delete")
    report_ids = select(Report.id).where(Report.store_id == sid)
    db.execute(delete(ReportItem).where(ReportItem.report_id.in_(report_ids)))
    db.execute(delete(Report).where(Report.store_id == sid))
    db.execute(delete(User).where(User.store_id == sid))
    db.execute(delete(Store).where(Store.id == sid))
    audit(db, request, user.login, user.role, "видалено магазин", s.name if s else f"№{sid}")
    db.commit()
    return RedirectResponse("/admin", 303)


def new_password(pw: str) -> str:
    if len(pw) < 6:
        raise HTTPException(400, "Пароль має бути щонайменше 6 символів")
    return pw


@app.post("/admin/stores/{sid}/password")
def store_password(request: Request, sid: int, password: str = Form(), user: User = Depends(admin_required),
                   db: Session = Depends(get_db)):
    store_user = db.scalar(select(User).where(User.store_id == sid, User.role == "store"))
    if not store_user:
        raise HTTPException(404)
    store_user.password_hash = hash_pw(new_password(password))
    audit(db, request, user.login, user.role, "змінено пароль магазину", store_user.login)
    db.commit()
    return RedirectResponse("/admin?pw=1", 303)


@app.post("/admin/password")
def admin_password(request: Request, password: str = Form(), user: User = Depends(admin_required),
                   db: Session = Depends(get_db)):
    user.password_hash = hash_pw(new_password(password))
    audit(db, request, user.login, user.role, "змінено пароль адміністратора")
    db.commit()
    return RedirectResponse("/admin?pw=1", 303)


# ---------- admin: action log ----------
@app.get("/admin/logs")
def logs_page(request: Request, login: str | None = None, action: str | None = None,
              user: User = Depends(admin_required), db: Session = Depends(get_db)):
    q = select(AuditLog)
    if login:
        q = q.where(AuditLog.login.contains(login.strip().lower()))
    if action:
        q = q.where(AuditLog.action == action)
    logs = db.scalars(q.order_by(AuditLog.id.desc()).limit(200)).all()
    ctx = {"user": user, "logs": logs, "actions": ACTIONS, "login": login or "", "action": action or ""}
    return templates.TemplateResponse(request, "logs.html", ctx)


# ---------- admin: individual reports, lock / unlock ----------
def report_total(r: Report) -> int:
    return sum(i.quantity * i.unit_price_cents for i in r.items)


@app.get("/admin/reports")
def reports_page(request: Request, period: str | None = None, user: User = Depends(admin_required),
                 db: Session = Depends(get_db)):
    period = parse_period(period)
    reports = {r.store_id: r for r in db.scalars(select(Report).where(Report.period == period))}
    rows = [{"store": s, "report": reports.get(s.id), "total": report_total(reports[s.id]) if s.id in reports else 0}
            for s in db.scalars(select(Store).order_by(Store.name))]
    return templates.TemplateResponse(request, "reports.html", {"user": user, "period": period, "rows": rows})


@app.get("/admin/reports/{rid}")
def report_view(rid: int, request: Request, user: User = Depends(admin_required), db: Session = Depends(get_db)):
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(404)
    rows = [{"name": i.product.name, "price": i.unit_price_cents, "qty": i.quantity,
             "sum": i.quantity * i.unit_price_cents} for i in sorted(report.items, key=lambda i: i.product.name)]
    ctx = {"user": user, "report": report, "rows": rows, "total": report_total(report)}
    return templates.TemplateResponse(request, "report_view.html", ctx)


@app.post("/admin/reports/{rid}/status")
def report_status(request: Request, rid: int, status: str = Form(), user: User = Depends(admin_required),
                  db: Session = Depends(get_db)):
    report = db.get(Report, rid)
    if not report or status not in ("draft", "submitted"):
        raise HTTPException(400, "Некоректний запит")
    report.status = status
    audit(db, request, user.login, user.role,
          "заблоковано звіт" if status == "submitted" else "розблоковано звіт",
          f"{report.store.name if report.store else '?'} · {report.period}")
    db.commit()
    return RedirectResponse(f"/admin/reports/{rid}", 303)


# ---------- admin: monthly summary ----------
def build_summary(db: Session, period: str, submitted_only: bool = False):
    stores = db.scalars(select(Store).order_by(Store.name)).all()
    products = db.scalars(select(Product).order_by(Product.name)).all()
    qty, amt = defaultdict(int), defaultdict(int)
    q = (select(Report.store_id, ReportItem.product_id, ReportItem.quantity, ReportItem.unit_price_cents)
         .select_from(ReportItem).join(Report, ReportItem.report_id == Report.id)
         .where(Report.period == period))
    if submitted_only:
        q = q.where(Report.status == "submitted")
    for sid, pid, n, price in db.execute(q):
        qty[pid, sid] += n
        amt[pid, sid] += n * price
    rows = [{
        "name": p.name,
        "cells": [qty[p.id, s.id] for s in stores],
        "qty": sum(qty[p.id, s.id] for s in stores),
        "sum": sum(amt[p.id, s.id] for s in stores),
    } for p in products]
    store_sums = [sum(amt[p.id, s.id] for p in products) for s in stores]
    return stores, rows, store_sums, sum(store_sums)


@app.get("/admin/summary")
def summary_page(request: Request, period: str | None = None, submitted_only: bool = False, user: User = Depends(admin_required),
                 db: Session = Depends(get_db)):
    period = parse_period(period)
    stores, rows, store_sums, grand = build_summary(db, period, submitted_only)
    ctx = {"user": user, "period": period, "stores": stores, "rows": rows, "store_sums": store_sums, "grand": grand,
           "submitted_only": submitted_only}
    return templates.TemplateResponse(request, "summary.html", ctx)


@app.get("/admin/summary.csv")
def summary_csv(period: str | None = None, submitted_only: bool = False, user: User = Depends(admin_required), db: Session = Depends(get_db)):
    period = parse_period(period)
    stores, rows, store_sums, grand = build_summary(db, period, submitted_only)
    out = io.StringIO()
    wr = csv.writer(out)
    wr.writerow(["Товар", *[s.name for s in stores], "Кількість", "Сума"])
    for r in rows:
        wr.writerow([r["name"], *r["cells"], r["qty"], f"{r['sum'] / 100:.2f}"])
    wr.writerow(["Разом", *[f"{x / 100:.2f}" for x in store_sums], "", f"{grand / 100:.2f}"])
    return Response(
        "\ufeff" + out.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="zvit-{period}.csv"'},
    )


if __name__ == "__main__":  # also the entry point for the compiled exe (Nuitka)
    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))
