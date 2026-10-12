"""Admin product management endpoints: CRUD, Excel import, and monthly price history."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from app.core.dependencies import admin_required, clean_name, to_cents
from app.core.ui import current_period, done, money
from app.db.backup import backup_db
from app.db.models.product import Product, ProductPrice
from app.db.models.report import ReportItem
from app.db.models.user import User
from app.db.repositories.audit import audit
from app.db.repositories.products import history_of, load_history, save_history
from app.db.session import get_db
from app.services.excel import parse_products_excel
from app.services.pricing import BASE_PERIOD, apply_price_change, latest_price, offered_prices, period_month
from sqlalchemy import delete, func
from sqlmodel import select
from sqlmodel import Session


router = APIRouter()
MAX_IMPORT_BYTES = 10 * 1024 * 1024


@router.post("/import")
async def product_import(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    """Create products from an Excel workbook: column A=name, column B=price."""
    filename = (file.filename or "").lower()
    if not filename.endswith(".xlsx"):
        raise HTTPException(400, "Завантажте файл Excel у форматі .xlsx")
    # Read at most one byte over the limit so a huge upload cannot be loaded into RAM first.
    payload = await file.read(MAX_IMPORT_BYTES + 1)
    if not payload or len(payload) > MAX_IMPORT_BYTES:
        raise HTTPException(400, "Файл порожній або перевищує 10 МБ")
    return parse_products_excel(payload, db, user, request)


@router.post("")
def product_add(
    request: Request,
    name: str = Form(),
    price: str = Form(),
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    clean, cents = clean_name(name), to_cents(price)
    p = Product(name=clean, price_cents=cents)
    db.add(p)
    db.flush()
    db.add(ProductPrice(product_id=p.id, period=BASE_PERIOD, price_cents=cents))
    audit(
        db,
        request,
        user.login,
        user.role,
        "додано товар",
        f"{clean} · {money(cents)}",
    )
    db.commit()
    return done(
        request,
        f"/admin#p{p.id}",
        f"Товар «{clean}» додано з ціною {money(cents)}.",
    )


@router.post("/{pid}")
async def product_edit(
    request: Request,
    pid: int,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    form = await request.form()
    p = db.get(Product, pid)
    if not p or p.archived:
        raise HTTPException(404)

    raw_name = str(form.get("name") or "")
    name = clean_name(raw_name)
    is_active = form.get("active") is not None

    # A product has one price input. Ignore legacy extra_price fields from cached clients.
    raw_price = str(form.get("price") or "").strip()
    if not raw_price:
        raise HTTPException(400, "Необхідно вказати ціну")

    cents = to_cents(raw_price)
    period = current_period()
    said: list[str] = []
    history = history_of(load_history(db), p)

    # Collapse any legacy same-month variants to one price-change record.
    # The previous price is retained by apply_price_change as the first monthly history chip
    # and remains available in reports for this month.
    canonical_history = [
        (start, value) for start, value in history if period_month(start) != period
    ]
    before_now = offered_prices(canonical_history, period)[-1]
    new_history, prev_price, now_price = apply_price_change(
        canonical_history, period, cents
    )
    if new_history != history:
        save_history(db, pid, new_history)
        p.price_cents = latest_price(new_history)
        if len(offered_prices(new_history, period)) == 2:
            said.append(
                f"Ціну змінено: {money(before_now)} → {money(now_price)} з {period}. "
                f"У звітах {period} збережуться попередня й нова ціни; "
                f"у наступних місяцях діятиме лише {money(now_price)}."
            )
        else:
            said.append(
                f"Зміну ціни за {period} скасовано: ціна знову {money(now_price)}, "
                f"у звітах {period} залишиться один рядок."
            )
        audit(
            db,
            request,
            user.login,
            user.role,
            "змінено ціну товару",
            f"{p.name} · {money(before_now)} → {money(now_price)} з {period}",
        )

    notes = []
    if name != p.name:
        notes.append(f"назва «{p.name}» → «{name}»")
        p.name = name
    if is_active != p.active:
        notes.append(
            "увімкнено"
            if is_active
            else "вимкнено (не показується в нових звітах, дані збережено)"
        )
        p.active = is_active
    if notes:
        said.append("Збережено: " + "; ".join(notes) + ".")
        audit(
            db,
            request,
            user.login,
            user.role,
            "змінено товар",
            f"{p.name} · " + "; ".join(notes),
        )
    db.commit()
    return done(
        request,
        f"/admin#p{pid}",
        " ".join(said) if said else "Змін немає: нічого не збережено.",
        "ok" if said else "info",
    )


@router.post("/{pid}/delete")
def product_delete(
    request: Request,
    pid: int,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    p = db.get(Product, pid)
    if not p:
        raise HTTPException(404)
    used = (
        db.scalar(
            select(func.count(ReportItem.id)).where(
                ReportItem.product_id == pid
            )
        )
        or 0
    )
    if used:  # never touch report data: move to the archive instead
        p.archived, p.active = True, False
        audit(
            db,
            request,
            user.login,
            user.role,
            "архівовано товар",
            f"{p.name} · рядків у звітах: {used}",
        )
        db.commit()
        return done(
            request,
            "/admin#archive",
            f"«{p.name}» є у звітах ({used} рядків), тому його не видалено, "
            "а переміщено в архів. Усі дані звітів збережено; товар можна відновити.",
        )
    backup_db("before-delete")
    name = p.name
    db.execute(delete(ProductPrice).where(ProductPrice.product_id == pid))
    db.execute(delete(Product).where(Product.id == pid))
    audit(db, request, user.login, user.role, "видалено товар", name)
    db.commit()
    return done(
        request, "/admin#products", f"Товар «{name}» видалено: у звітах його не було."
    )


@router.post("/{pid}/restore")
def product_restore(
    request: Request,
    pid: int,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    p = db.get(Product, pid)
    if not p:
        raise HTTPException(404)
    p.archived, p.active = False, True
    audit(db, request, user.login, user.role, "відновлено товар", p.name)
    db.commit()
    return done(request, f"/admin#p{pid}", f"Товар «{p.name}» відновлено й активовано.")
