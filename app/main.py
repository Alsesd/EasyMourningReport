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

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from .backup import backup_db, backup_loop
from .ratelimit import clear_failures, record_failure, retry_after
from .models import DB_PATH, Base, Product, Report, ReportItem, SessionLocal, Store, User, engine


def hash_pw(pw: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    return salt.hex() + "$" + hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000).hex()


def check_pw(pw: str, stored: str) -> bool:
    return hmac.compare_digest(hash_pw(pw, bytes.fromhex(stored.split("$")[0])), stored)


def seed():
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)):
            return
        admin_pw = os.getenv("ADMIN_PASSWORD") or secrets.token_urlsafe(9)
        db.add(User(login="admin", password_hash=hash_pw(admin_pw), role="admin"))
        print(f"\n*** FIRST RUN: login 'admin', password '{admin_pw}'. Change it on the Admin page. ***\n", flush=True)
        if not os.getenv("DEMO"):
            db.commit()
            return
        db.add_all([
            Product(name="Apples, kg", price_cents=250),
            Product(name="Bread", price_cents=120),
            Product(name="Milk, 1 l", price_cents=95),
        ])
        for n in (1, 2):
            s = Store(name=f"Store {n}")
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
    path = DB_PATH.parent / "secret.key"  # generated once, kept next to the database
    if not path.exists():
        path.write_text(secrets.token_hex(32))
    return path.read_text().strip()


app.add_middleware(SessionMiddleware, secret_key=load_secret(), https_only=os.getenv("COOKIE_SECURE") == "1",
                   max_age=7 * 24 * 3600)
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")
templates.env.filters["money"] = lambda c: f"{c / 100:.2f}"

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
        raise HTTPException(403, "Admins only")
    return user


def store_required(user: User = Depends(user_required)) -> User:
    if user.role != "store":
        raise HTTPException(403, "Store users only")
    return user


def parse_period(p: str | None) -> str:
    p = p or date.today().strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", p):
        raise HTTPException(400, "Period must look like 2026-10")
    return p


def to_cents(s: str) -> int:
    try:
        cents = int((Decimal(s.replace(",", ".")) * 100).to_integral_value())
    except InvalidOperation:
        raise HTTPException(400, "Bad price")
    if cents < 0:
        raise HTTPException(400, "Bad price")
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
    ip, key = client_ip(request), login.strip().lower()
    wait = retry_after(ip, key)
    if wait:
        msg = f"Too many attempts. Try again in {wait // 60 + 1} min."
        return templates.TemplateResponse(request, "login.html", {"user": None, "error": msg}, status_code=429)
    user = db.scalar(select(User).where(User.login == login))
    if not user or not check_pw(password, user.password_hash):
        record_failure(ip, key)
        return templates.TemplateResponse(
            request, "login.html", {"user": None, "error": "Wrong login or password"}, status_code=401
        )
    clear_failures(ip, key)
    request.session.clear()
    request.session["uid"] = user.id
    return RedirectResponse("/", 303)


@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", 303)


@app.get("/")
def index(user: User = Depends(user_required)):
    return RedirectResponse("/admin" if user.role == "admin" else "/report", 303)


# ---------- store: monthly report (quantities only) ----------
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
    saved = {i.product_id: i for i in report.items} if report else {}
    rows, total = [], 0
    for p in db.scalars(select(Product).where(Product.active).order_by(Product.name)):
        it = saved.get(p.id)
        qty = it.quantity if it else 0
        price = it.unit_price_cents if it else p.price_cents
        rows.append({"id": p.id, "name": p.name, "price": price, "qty": qty, "sum": qty * price})
        total += qty * price
    ctx = {"user": user, "period": period, "rows": rows, "total": total, "saved": "saved" in request.query_params,
           "status": report.status if report else "new",
           "min_period": min(known | {current}), "max_period": current,
           "missing": request.query_params.get("missing")}
    return templates.TemplateResponse(request, "report.html", ctx)


@app.post("/report")
async def report_save(request: Request, user: User = Depends(store_required), db: Session = Depends(get_db)):
    form = await request.form()
    period = parse_period(form.get("period"))
    if period != date.today().strftime("%Y-%m") and period not in store_periods(db, user.store_id):
        raise HTTPException(403, "No report exists for that month")
    report = find_report(db, user.store_id, period)
    if report and report.status == "submitted":
        raise HTTPException(409, "This report is submitted and locked. Ask the admin to unlock it.")
    if not report:
        report = Report(store_id=user.store_id, period=period, status="draft")
        db.add(report)
    saved = {i.product_id: i for i in report.items}
    for p in db.scalars(select(Product).where(Product.active)):
        try:
            qty = int(form.get(f"qty_{p.id}") or 0)
        except ValueError:
            raise HTTPException(400, "Quantity must be a whole number")
        if qty < 0:
            raise HTTPException(400, "Quantity cannot be negative")
        it = saved.get(p.id)
        if it:
            it.quantity, it.unit_price_cents = qty, p.price_cents
        else:
            report.items.append(ReportItem(product_id=p.id, quantity=qty, unit_price_cents=p.price_cents))
    if form.get("action") == "submit":
        report.status = "submitted"
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
def product_add(name: str = Form(), price: str = Form(), user: User = Depends(admin_required),
                db: Session = Depends(get_db)):
    db.add(Product(name=name.strip(), price_cents=to_cents(price)))
    db.commit()
    return RedirectResponse("/admin", 303)


@app.post("/admin/products/{pid}")
def product_edit(pid: int, name: str = Form(), price: str = Form(), active: str | None = Form(None),
                 user: User = Depends(admin_required), db: Session = Depends(get_db)):
    p = db.get(Product, pid)
    if not p:
        raise HTTPException(404)
    p.name, p.price_cents, p.active = name.strip(), to_cents(price), active is not None
    db.commit()
    return RedirectResponse("/admin", 303)


@app.post("/admin/stores")
def store_add(name: str = Form(), login: str = Form(), password: str = Form(),
              user: User = Depends(admin_required), db: Session = Depends(get_db)):
    store = Store(name=name.strip())
    db.add(store)
    try:
        db.flush()
        db.add(User(login=login.strip(), password_hash=hash_pw(new_password(password)), role="store", store_id=store.id))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Store name or login already exists")
    return RedirectResponse("/admin", 303)


@app.post("/admin/products/{pid}/delete")
def product_delete(pid: int, user: User = Depends(admin_required), db: Session = Depends(get_db)):
    backup_db("before-delete")
    db.execute(delete(ReportItem).where(ReportItem.product_id == pid))
    db.execute(delete(Product).where(Product.id == pid))
    db.commit()
    return RedirectResponse("/admin", 303)


@app.post("/admin/stores/{sid}/delete")
def store_delete(sid: int, user: User = Depends(admin_required), db: Session = Depends(get_db)):
    backup_db("before-delete")
    report_ids = select(Report.id).where(Report.store_id == sid)
    db.execute(delete(ReportItem).where(ReportItem.report_id.in_(report_ids)))
    db.execute(delete(Report).where(Report.store_id == sid))
    db.execute(delete(User).where(User.store_id == sid))
    db.execute(delete(Store).where(Store.id == sid))
    db.commit()
    return RedirectResponse("/admin", 303)


def new_password(pw: str) -> str:
    if len(pw) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    return pw


@app.post("/admin/stores/{sid}/password")
def store_password(sid: int, password: str = Form(), user: User = Depends(admin_required),
                   db: Session = Depends(get_db)):
    store_user = db.scalar(select(User).where(User.store_id == sid, User.role == "store"))
    if not store_user:
        raise HTTPException(404)
    store_user.password_hash = hash_pw(new_password(password))
    db.commit()
    return RedirectResponse("/admin?pw=1", 303)


@app.post("/admin/password")
def admin_password(password: str = Form(), user: User = Depends(admin_required), db: Session = Depends(get_db)):
    user.password_hash = hash_pw(new_password(password))
    db.commit()
    return RedirectResponse("/admin?pw=1", 303)


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
def report_status(rid: int, status: str = Form(), user: User = Depends(admin_required),
                  db: Session = Depends(get_db)):
    report = db.get(Report, rid)
    if not report or status not in ("draft", "submitted"):
        raise HTTPException(400, "Bad request")
    report.status = status
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
    w = csv.writer(out)
    w.writerow(["Product", *[s.name for s in stores], "Total qty", "Total sum"])
    for r in rows:
        w.writerow([r["name"], *r["cells"], r["qty"], f"{r['sum'] / 100:.2f}"])
    w.writerow(["Total sum", *[f"{x / 100:.2f}" for x in store_sums], "", f"{grand / 100:.2f}"])
    return Response(
        "\ufeff" + out.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="report-{period}.csv"'},
    )
