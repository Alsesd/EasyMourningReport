"""Versioned REST endpoints for the client-rendered UI.

The browser sends DTOs and receives DTOs only; ORM models stay behind this
boundary. Existing HTML form routes remain available for old bookmarks and
for the Excel upload flow while the UI is migrated incrementally.
"""
from collections import defaultdict

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import delete, func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.dependencies import clean_login, clean_name, new_password, parse_period, to_cents
from app.core.security import hash_pw
from app.core.tailscale import get_status as tailscale_status, start_funnel, stop_funnel
from app.core.ui import FormError, current_period, money
from app.db.backup import backup_db
from app.db.models.audit import AuditLog
from app.db.models.product import Product, ProductPrice
from app.db.models.report import Report, ReportItem
from app.db.models.store import Store
from app.db.models.user import User
from app.db.repositories.audit import ACTIONS, audit
from app.db.repositories.products import history_of, load_history, save_history
from app.db.repositories.reports import build_lines, build_summary, find_report, report_total
from app.db.repositories.stores import check_unique_store, store_periods
from app.db.session import get_db
from app.services.excel import parse_products_excel
from app.services.pricing import (
    BASE_PERIOD,
    apply_price_change,
    latest_price,
    month_price_timeline,
    offered_prices,
)

from app.dto import (
    AdminReportDTO,
    AdminReportDetailDTO,
    AdminReportListItemDTO,
    AuditLogDTO,
    ImportResultDTO,
    InactiveReportLineDTO,
    MessageDTO,
    MutationDTO,
    PasswordDTO,
    PricePointDTO,
    ProductCreateDTO,
    ProductDTO,
    ProductUpdateDTO,
    ReportInputDTO,
    ReportLineDTO,
    ReportQuantityDTO,
    ReportSaveDTO,
    ReportStatusDTO,
    SessionDTO,
    StoreCreateDTO,
    StoreDTO,
    StorePasswordDTO,
    StoreReportDTO,
    StoreUpdateDTO,
    SummaryDTO,
    SummaryRowDTO,
    SummaryStoreDTO,
)


router = APIRouter(tags=["REST API v1"])

def api_user_required(
    request: Request, db: Session = Depends(get_db)
) -> User:
    """Authenticate using the existing signed session cookie, but return JSON errors."""
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user and user.role == "store" and (not user.store or user.store.archived):
        user = None
    if not user:
        raise HTTPException(status_code=401, detail="Увійдіть у систему.")
    return user


def api_admin_required(user: User = Depends(api_user_required)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Лише для адміністраторів.")
    return user


def api_store_required(user: User = Depends(api_user_required)) -> User:
    if user.role != "store":
        raise HTTPException(status_code=403, detail="Лише для користувачів магазинів.")
    return user


@router.get("/admin/tailscale")
def get_tailscale_status(
    user: User = Depends(api_admin_required),
) -> dict:
    """Return the app-specific Tailscale Funnel status without credentials."""
    return tailscale_status()


@router.post("/admin/tailscale")
def enable_tailscale_funnel(
    payload: dict,
    user: User = Depends(api_admin_required),
) -> dict:
    """Explicitly enable the optional public Funnel; never persist an auth key."""
    if payload.get("confirm_public") is not True:
        raise HTTPException(
            status_code=400,
            detail="Підтвердьте, що Funnel відкриває застосунок для публічного доступу.",
        )
    auth_key = payload.get("auth_key")
    if auth_key is not None and not isinstance(auth_key, str):
        raise HTTPException(status_code=422, detail="Некоректний формат auth key.")
    result = start_funnel(auth_key or None)
    if result.get("state") == "error":
        raise HTTPException(status_code=503, detail=result.get("error") or "Tailscale не запустився.")
    return result


@router.delete("/admin/tailscale")
def disable_tailscale_funnel(
    user: User = Depends(api_admin_required),
) -> dict:
    """Stop public exposure and clear the persistent opt-in."""
    result = stop_funnel()
    if result.get("state") == "error":
        raise HTTPException(status_code=500, detail=result.get("error") or "Не вдалося вимкнути Funnel.")
    return result

def _product_dto(
    db: Session,
    product: Product,
    used_count: int = 0,
    period: str | None = None,
    all_history: dict[int, list[tuple[str, int]]] | None = None,
) -> ProductDTO:
    active_period = parse_period(period or current_period())
    history = all_history if all_history is not None else load_history(db)
    product_history = history_of(history, product)
    return ProductDTO(
        id=product.id,
        name=product.name,
        price_cents=product.price_cents,
        active=product.active,
        archived=product.archived,
        used_count=used_count,
        month_prices_cents=month_price_timeline(product_history, active_period),
        price_history=[PricePointDTO(period=month, price_cents=cents) for month, cents in product_history],
    )


def _product_usage(db: Session) -> dict[int, int]:
    return {
        pid: count
        for pid, count in db.execute(
            select(ReportItem.product_id, func.count(ReportItem.id)).group_by(ReportItem.product_id)
        )
    }


def _store_dto(db: Session, store: Store, store_user: User, report_counts: dict[int, int] | None = None) -> StoreDTO:
    counts = report_counts
    if counts is None:
        counts = {
            sid: count
            for sid, count in db.execute(
                select(Report.store_id, func.count(Report.id)).group_by(Report.store_id)
            )
        }
    return StoreDTO(
        id=store.id,
        name=store.name,
        login=store_user.login,
        archived=store.archived,
        reports_count=counts.get(store.id, 0),
    )


def _report_line_dtos(rows: list[dict]) -> list[ReportLineDTO]:
    return [
        ReportLineDTO(
            id=row["id"],
            name=row["name"],
            repriced=row["repriced"],
            sum_cents=row["sum"],
            inputs=[
                ReportInputDTO(
                    price_cents=line["price"],
                    quantity=line["qty"],
                    label=line["label"],
                    sum_cents=line["qty"] * line["price"],
                )
                for line in row["inputs"]
            ],
        )
        for row in rows
    ]


def _inactive_line_dtos(rows: list[dict]) -> list[InactiveReportLineDTO]:
    return [
        InactiveReportLineDTO(
            name=row["name"],
            archived=row["archived"],
            lines=row["lines"],
            sum_cents=row["sum"],
        )
        for row in rows
    ]


def _store_report_dto(
    db: Session, user: User, period: str, report: Report | None
) -> StoreReportDTO:
    rows, inactive, inactive_total = build_lines(db, period, report.items if report else [])
    known = store_periods(db, user.store_id)
    return StoreReportDTO(
        report_id=report.id if report else None,
        store_name=user.store.name if user.store else user.login,
        period=period,
        status=report.status if report else "new",
        read_only=bool(report and report.status == "submitted"),
        rows=_report_line_dtos(rows),
        inactive_rows=_inactive_line_dtos(inactive),
        inactive_total_cents=inactive_total,
        total_cents=sum(row["sum"] for row in rows) + inactive_total,
        available_periods=sorted(known | {current_period()}),
    )


@router.get("/session", response_model=SessionDTO)
def get_session(user: User = Depends(api_user_required)) -> SessionDTO:
    return SessionDTO(
        login=user.login,
        role=user.role,
        store_id=user.store_id,
        store_name=user.store.name if user.store else None,
        period=current_period(),
    )


# --- Administrator: products -------------------------------------------------

@router.get("/admin/products", response_model=list[ProductDTO])
def list_products(
    period: str | None = None,
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> list[ProductDTO]:
    active_period = parse_period(period)
    used = _product_usage(db)
    history = load_history(db)
    products = db.scalars(select(Product).order_by(Product.name)).all()
    return [
        _product_dto(db, product, used.get(product.id, 0), active_period, history)
        for product in products
    ]


@router.post("/admin/products/import", response_model=ImportResultDTO)
async def import_products(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> ImportResultDTO:
    """Import an Excel workbook through the JSON API with a bounded upload."""
    max_import_bytes = 10 * 1024 * 1024
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Завантажте файл Excel у форматі .xlsx")
    payload = await file.read(max_import_bytes + 1)
    if not payload or len(payload) > max_import_bytes:
        raise HTTPException(status_code=400, detail="Файл порожній або перевищує 10 МБ")
    # Reuse the existing import parser/transaction. Its legacy redirect is discarded;
    # the flash message is returned as a DTO to the client-rendered page.
    request.session.pop("flash", None)
    parse_products_excel(payload, db, user, request)
    flash = request.session.pop("flash", None) or {}
    return ImportResultDTO(message=flash.get("text", "Імпорт завершено."))


@router.post("/admin/products", response_model=ProductDTO, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreateDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> ProductDTO:
    name = clean_name(payload.name)
    cents = to_cents(payload.price)
    product = Product(name=name, price_cents=cents)
    db.add(product)
    db.flush()
    db.add(ProductPrice(product_id=product.id, period=BASE_PERIOD, price_cents=cents))
    audit(db, request, user.login, user.role, "додано товар", f"{name} · {money(cents)}")
    db.commit()
    db.refresh(product)
    return _product_dto(db, product)


@router.put("/admin/products/{pid}/price", response_model=ProductDTO)
def update_product_price(
    pid: int,
    payload: dict,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> ProductDTO:
    """Change only a product's price, preserving all month history and product edits."""
    product = db.get(Product, pid)
    if not product or product.archived:
        raise HTTPException(status_code=404, detail="Товар не знайдено.")
    raw_price = str(payload.get("price") or "").strip()
    if not raw_price:
        raise HTTPException(status_code=400, detail="Вкажіть нову ціну.")
    cents = to_cents(raw_price)
    period = current_period()
    history = history_of(load_history(db), product)
    new_history, previous, now = apply_price_change(history, period, cents)
    if new_history != history:
        save_history(db, pid, new_history)
        product.price_cents = latest_price(new_history)
        audit(
            db, request, user.login, user.role, "змінено ціну товару",
            f"{product.name} · {money(previous)} → {money(now)} з {period}",
        )
        db.commit()
        db.refresh(product)
    return _product_dto(db, product, _product_usage(db).get(pid, 0))


@router.put("/admin/products/{pid}", response_model=ProductDTO)
def update_product(
    pid: int,
    payload: ProductUpdateDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> ProductDTO:
    product = db.get(Product, pid)
    if not product or product.archived:
        raise HTTPException(status_code=404, detail="Товар не знайдено.")
    name = clean_name(payload.name)
    cents = to_cents(payload.price)
    period = current_period()
    history = history_of(load_history(db), product)
    # A price update is a new event, not a replacement of this month's history.
    new_history, previous, now = apply_price_change(history, period, cents)
    if new_history != history:
        save_history(db, pid, new_history)
        product.price_cents = latest_price(new_history)
        audit(
            db, request, user.login, user.role, "змінено ціну товару",
            f"{product.name} · {money(previous)} → {money(now)} з {period}",
        )
    changed = []
    if product.name != name:
        changed.append(f"назва «{product.name}» → «{name}»")
        product.name = name
    if product.active != payload.active:
        product.active = payload.active
        changed.append("увімкнено" if payload.active else "вимкнено")
    if changed:
        audit(db, request, user.login, user.role, "змінено товар", f"{name} · " + "; ".join(changed))
    db.commit()
    db.refresh(product)
    return _product_dto(db, product, _product_usage(db).get(pid, 0))


@router.delete("/admin/products/{pid}", response_model=MutationDTO)
def delete_product(
    pid: int,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> MutationDTO:
    product = db.get(Product, pid)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не знайдено.")
    used = db.scalar(select(func.count(ReportItem.id)).where(ReportItem.product_id == pid)) or 0
    if used:
        product.archived, product.active = True, False
        audit(db, request, user.login, user.role, "архівовано товар", f"{product.name} · рядків у звітах: {used}")
        db.commit()
        return MutationDTO(id=pid, archived=True, message=f"«{product.name}» переміщено в архів. Дані звітів збережено.")
    backup_db("before-delete")
    name = product.name
    db.execute(delete(ProductPrice).where(ProductPrice.product_id == pid))
    db.execute(delete(Product).where(Product.id == pid))
    audit(db, request, user.login, user.role, "видалено товар", name)
    db.commit()
    return MutationDTO(id=pid, deleted=True, message=f"Товар «{name}» остаточно видалено.")


@router.post("/admin/products/{pid}/restore", response_model=ProductDTO)
def restore_product(
    pid: int,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> ProductDTO:
    product = db.get(Product, pid)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не знайдено.")
    product.archived, product.active = False, True
    audit(db, request, user.login, user.role, "відновлено товар", product.name)
    db.commit()
    db.refresh(product)
    return _product_dto(db, product, _product_usage(db).get(pid, 0))


# --- Administrator: stores ---------------------------------------------------

@router.get("/admin/stores", response_model=list[StoreDTO])
def list_stores(
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> list[StoreDTO]:
    counts = {
        sid: count
        for sid, count in db.execute(
            select(Report.store_id, func.count(Report.id)).group_by(Report.store_id)
        )
    }
    store_users = db.scalars(select(User).where(User.role == "store").order_by(User.login)).all()
    result = []
    for account in store_users:
        if account.store:
            result.append(_store_dto(db, account.store, account, counts))
    return sorted(result, key=lambda item: item.name.casefold())


@router.post("/admin/stores", response_model=StoreDTO, status_code=status.HTTP_201_CREATED)
def create_store(
    payload: StoreCreateDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> StoreDTO:
    name = clean_name(payload.name, "Назва магазину")
    login = clean_login(payload.login)
    password = new_password(payload.password)
    check_unique_store(db, name, login)
    store = Store(name=name)
    db.add(store)
    try:
        db.flush()
        account = User(login=login, password_hash=hash_pw(password), role="store", store_id=store.id)
        db.add(account)
        audit(db, request, user.login, user.role, "додано магазин", f"{name} · логін {login}")
        db.commit()
        db.refresh(store)
        db.refresh(account)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Магазин із такою назвою або логін уже існує.")
    return _store_dto(db, store, account, {})


@router.put("/admin/stores/{sid}", response_model=StoreDTO)
def update_store(
    sid: int,
    payload: StoreUpdateDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> StoreDTO:
    store = db.get(Store, sid)
    account = db.scalar(select(User).where(User.store_id == sid, User.role == "store"))
    if not store or not account:
        raise HTTPException(status_code=404, detail="Магазин не знайдено.")
    name, login = clean_name(payload.name, "Назва магазину"), clean_login(payload.login)
    check_unique_store(db, name, login, store_id=sid, user_id=account.id)
    notes = []
    if store.name != name:
        notes.append(f"назва «{store.name}» → «{name}»")
        store.name = name
    if account.login != login:
        notes.append(f"логін {account.login} → {login}")
        account.login = login
    if notes:
        audit(db, request, user.login, user.role, "змінено магазин", "; ".join(notes))
    try:
        db.commit()
        db.refresh(store)
        db.refresh(account)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Магазин із такою назвою або логін уже існує.")
    return _store_dto(db, store, account)


@router.delete("/admin/stores/{sid}", response_model=MutationDTO)
def delete_store(
    sid: int,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> MutationDTO:
    store = db.get(Store, sid)
    if not store:
        raise HTTPException(status_code=404, detail="Магазин не знайдено.")
    count = db.scalar(select(func.count(Report.id)).where(Report.store_id == sid)) or 0
    if count:
        store.archived = True
        audit(db, request, user.login, user.role, "архівовано магазин", f"{store.name} · звітів: {count}")
        db.commit()
        return MutationDTO(id=sid, archived=True, message=f"«{store.name}» переміщено в архів. Звіти збережено.")
    backup_db("before-delete")
    name = store.name
    db.execute(delete(User).where(User.store_id == sid))
    db.execute(delete(Store).where(Store.id == sid))
    audit(db, request, user.login, user.role, "видалено магазин", name)
    db.commit()
    return MutationDTO(id=sid, deleted=True, message=f"Магазин «{name}» остаточно видалено.")


@router.post("/admin/stores/{sid}/restore", response_model=StoreDTO)
def restore_store(
    sid: int,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> StoreDTO:
    store = db.get(Store, sid)
    account = db.scalar(select(User).where(User.store_id == sid, User.role == "store"))
    if not store or not account:
        raise HTTPException(status_code=404, detail="Магазин не знайдено.")
    store.archived = False
    audit(db, request, user.login, user.role, "відновлено магазин", store.name)
    db.commit()
    return _store_dto(db, store, account)


@router.put("/admin/password", response_model=MessageDTO)
def update_admin_password(
    payload: PasswordDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> MessageDTO:
    user.password_hash = hash_pw(new_password(payload.password))
    audit(db, request, user.login, user.role, "змінено пароль адміністратора")
    db.commit()
    return MessageDTO(message="Ваш пароль змінено.")


@router.put("/admin/stores/{sid}/password", response_model=MessageDTO)
def reset_store_password(
    sid: int,
    payload: StorePasswordDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> MessageDTO:
    account = db.scalar(select(User).where(User.store_id == sid, User.role == "store"))
    if not account:
        raise HTTPException(status_code=404, detail="Обліковий запис магазину не знайдено.")
    account.password_hash = hash_pw(new_password(payload.password))
    audit(db, request, user.login, user.role, "змінено пароль магазину", account.login)
    db.commit()
    return MessageDTO(message=f"Пароль для «{account.login}» змінено.")


# --- Store: monthly report ---------------------------------------------------

@router.get("/store/reports/{period}", response_model=StoreReportDTO)
def read_store_report(
    period: str,
    user: User = Depends(api_store_required),
    db: Session = Depends(get_db),
) -> StoreReportDTO:
    selected = parse_period(period)
    known = store_periods(db, user.store_id)
    if selected != current_period() and selected not in known:
        raise HTTPException(status_code=404, detail=f"Звіту за {selected} немає.")
    report = find_report(db, user.store_id, selected)
    return _store_report_dto(db, user, selected, report)


@router.put("/store/reports/{period}", response_model=StoreReportDTO)
def save_store_report(
    period: str,
    payload: ReportSaveDTO,
    request: Request,
    user: User = Depends(api_store_required),
    db: Session = Depends(get_db),
) -> StoreReportDTO:
    selected = parse_period(period)
    known = store_periods(db, user.store_id)
    if selected != current_period() and selected not in known:
        raise HTTPException(status_code=403, detail=f"Звіту за {selected} не існує.")
    report = find_report(db, user.store_id, selected)
    if report and report.status == "submitted":
        raise HTTPException(status_code=409, detail="Звіт надіслано й заблоковано адміністратором.")

    if not report:
        report = Report(store_id=user.store_id, period=selected, status="draft")
        db.add(report)
        db.flush()

    history = load_history(db)
    allowed: dict[int, set[int]] = {}
    for product in db.scalars(select(Product).where(Product.active, Product.archived.is_(False))):
        allowed[product.id] = set(offered_prices(history_of(history, product), selected))
    for item in report.items:
        if item.product_id in allowed and item.quantity > 0:
            allowed[item.product_id].add(item.unit_price_cents)

    seen: set[tuple[int, int]] = set()
    quantities: dict[int, dict[int, int]] = defaultdict(dict)
    for line in payload.quantities:
        key = (line.product_id, line.price_cents)
        if key in seen:
            raise HTTPException(status_code=422, detail="Повторюється рядок товару/ціни.")
        seen.add(key)
        if line.quantity == 0:
            continue
        if line.price_cents not in allowed.get(line.product_id, set()):
            raise HTTPException(
                status_code=409,
                detail="Список товарів або ціни змінилися. Оновіть звіт і повторіть збереження.",
            )
        quantities[line.product_id][line.price_cents] = line.quantity

    # Preserve saved rows for inactive/archived products; those rows are read-only in the UI.
    preserved = [item for item in report.items if item.product_id not in allowed]
    new_items = list(preserved)
    for product_id in allowed:
        for price, quantity in quantities.get(product_id, {}).items():
            new_items.append(
                ReportItem(product_id=product_id, quantity=quantity, unit_price_cents=price)
            )
    report.items = new_items
    submitting = payload.action == "submit"
    report.status = "submitted" if submitting else "draft"
    audit(
        db, request, user.login, user.role,
        "надіслано звіт" if submitting else "збережено звіт",
        f"{user.store.name if user.store else user.login} · {selected}",
    )
    db.commit()
    db.refresh(report)
    return _store_report_dto(db, user, selected, report)


# --- Administrator: submitted reports and monthly summary -------------------

@router.get("/admin/reports", response_model=list[AdminReportListItemDTO])
def list_admin_reports(
    period: str | None = None,
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> list[AdminReportListItemDTO]:
    selected = parse_period(period)
    reports_by_store = {
        report.store_id: report
        for report in db.scalars(select(Report).where(Report.period == selected))
    }
    result = []
    for store in db.scalars(select(Store).order_by(Store.name)):
        report = reports_by_store.get(store.id)
        if store.archived and not report:
            continue
        result.append(
            AdminReportListItemDTO(
                store_id=store.id,
                store_name=store.name,
                store_archived=store.archived,
                report_id=report.id if report else None,
                period=selected,
                status=report.status if report else "none",
                total_cents=report_total(report) if report else 0,
                item_count=len(report.items) if report else 0,
            )
        )
    return result


@router.get("/admin/reports/{rid}", response_model=AdminReportDetailDTO)
def read_admin_report(
    rid: int,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> AdminReportDetailDTO:
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(status_code=404, detail="Звіт не знайдено.")
    request.session["period"] = report.period
    rows, inactive, inactive_total = build_lines(db, report.period, report.items)
    return AdminReportDetailDTO(
        report_id=report.id,
        store_id=report.store_id,
        store_name=report.store.name if report.store else "?",
        store_archived=bool(report.store and report.store.archived),
        period=report.period,
        status=report.status,
        total_cents=report_total(report),
        item_count=len(report.items),
        rows=_report_line_dtos(rows),
        inactive_rows=_inactive_line_dtos(inactive),
        inactive_total_cents=inactive_total,
    )


@router.patch("/admin/reports/{rid}", response_model=AdminReportDTO)
def update_admin_report_status(
    rid: int,
    payload: ReportStatusDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> AdminReportDTO:
    target = payload.status
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(status_code=404, detail="Звіт не знайдено.")
    report.status = target
    store = report.store
    audit(
        db, request, user.login, user.role,
        "заблоковано звіт" if target == "submitted" else "розблоковано звіт",
        f"{store.name if store else '?'} · {report.period}",
    )
    db.commit()
    db.refresh(report)
    return AdminReportDTO(
        report_id=report.id,
        store_id=report.store_id,
        store_name=store.name if store else "?",
        store_archived=bool(store and store.archived),
        period=report.period,
        status=report.status,
        total_cents=report_total(report),
        item_count=len(report.items),
    )


@router.get("/admin/summary", response_model=SummaryDTO)
def read_admin_summary(
    period: str | None = None,
    submitted_only: bool = False,
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> SummaryDTO:
    selected = parse_period(period)
    stores, rows, totals, grand = build_summary(db, selected, submitted_only)
    return SummaryDTO(
        period=selected,
        submitted_only=submitted_only,
        stores=[
            SummaryStoreDTO(id=store.id, name=store.name, archived=store.archived)
            for store in stores
        ],
        rows=[
            SummaryRowDTO(
                name=row["name"],
                note=row["note"],
                price_cents=row["price"],
                label=row["label"],
                cells=row["cells"],
                quantity=row["qty"],
                sum_cents=row["sum"],
            )
            for row in rows
        ],
        store_totals_cents=totals,
        grand_total_cents=grand,
    )


@router.get("/admin/log-actions", response_model=list[str])
def read_admin_log_actions(
    _: User = Depends(api_admin_required),
) -> list[str]:
    return ACTIONS


@router.get("/admin/logs", response_model=list[AuditLogDTO])
def read_admin_logs(
    login: str | None = None,
    action: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> list[AuditLogDTO]:
    query = select(AuditLog)
    if login:
        query = query.where(AuditLog.login.contains(login.strip().lower()))
    if action:
        query = query.where(AuditLog.action == action)
    return list(db.scalars(query.order_by(AuditLog.id.desc()).limit(limit)).all())
