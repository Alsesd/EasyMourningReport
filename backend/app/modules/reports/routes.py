"""REST endpoints of the reports module: catalogue, store reports, review, summary and settings."""

from collections import defaultdict

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func
from sqlmodel import Session, select

from app.core.dependencies import clean_name, parse_period, to_cents
from app.core.periods import current_period, money
from app.core.schemas import MutationDTO
from app.db.backup import backup_db
from app.db.session import get_db
from app.modules.reports.excel import generate_summary_excel, parse_products_excel
from app.modules.reports.models import Product, ProductPrice, Report, ReportItem
from app.modules.reports.permissions import CATALOG_MANAGE, REVIEW, SETTINGS_MANAGE, SUBMIT
from app.modules.reports.pricing import (
    BASE_PERIOD,
    apply_price_change,
    latest_price,
    month_price_timeline,
    offered_prices,
)
from app.modules.reports.products_repo import history_of, load_history, save_history
from app.modules.reports.reports_repo import (
    build_lines,
    replace_editable_items,
    build_summary,
    calculation_enabled,
    calculation_enabled_ids,
    find_report,
    report_total,
    reports_per_organisation,
    set_calculation_enabled,
    store_periods,
)
from app.modules.reports.schemas import (
    AdminReportDTO,
    AdminReportDetailDTO,
    AdminReportListItemDTO,
    ImportResultDTO,
    InactiveReportLineDTO,
    PricePointDTO,
    ProductCreateDTO,
    ProductDTO,
    ProductUpdateDTO,
    ReportInputDTO,
    ReportLineDTO,
    ReportSaveDTO,
    ReportSettingsDTO,
    ReportSettingsUpdateDTO,
    ReportStatusDTO,
    StoreReportDTO,
    SummaryDTO,
    SummaryRowDTO,
    SummaryStoreDTO,
)
from app.platform.accounts.access import Principal, require, require_member
from app.platform.accounts.models import Organisation
from app.platform.audit.service import audit

router = APIRouter(tags=["Reports"])


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
                    quantity_calc=line.get("qty_calc", 0),
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
    db: Session, principal: Principal, period: str, report: Report | None
) -> StoreReportDTO:
    org = principal.user.organisation
    enabled = calculation_enabled(db, principal.organisation_id)
    rows, inactive, inactive_total = build_lines(
        db,
        period,
        report.items if report else [],
        calculation_enabled=enabled,
    )
    known = store_periods(db, principal.organisation_id)
    return StoreReportDTO(
        report_id=report.id if report else None,
        store_name=org.name if org else principal.login,
        period=period,
        status=report.status if report else "new",
        read_only=bool(report and report.status == "submitted"),
        calculation_enabled=enabled,
        rows=_report_line_dtos(rows),
        inactive_rows=_inactive_line_dtos(inactive),
        inactive_total_cents=inactive_total,
        total_cents=sum(row["sum"] for row in rows) + inactive_total,
        available_periods=sorted(known | {current_period()}),
    )


# --- Administrator: products -------------------------------------------------

@router.get("/admin/products", response_model=list[ProductDTO])
def list_products(
    period: str | None = None,
    _: Principal = Depends(require(CATALOG_MANAGE)),
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
    principal: Principal = Depends(require(CATALOG_MANAGE)),
    db: Session = Depends(get_db),
) -> ImportResultDTO:
    """Import an Excel workbook through the JSON API with a bounded upload."""
    max_import_bytes = 10 * 1024 * 1024
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Завантажте файл Excel у форматі .xlsx")
    payload = await file.read(max_import_bytes + 1)
    if not payload or len(payload) > max_import_bytes:
        raise HTTPException(status_code=400, detail="Файл порожній або перевищує 10 МБ")
    message = parse_products_excel(payload, db, principal.login, principal.role_label, request)
    return ImportResultDTO(message=message)


@router.post("/admin/products", response_model=ProductDTO, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreateDTO,
    request: Request,
    principal: Principal = Depends(require(CATALOG_MANAGE)),
    db: Session = Depends(get_db),
) -> ProductDTO:
    name = clean_name(payload.name)
    cents = to_cents(payload.price)
    product = Product(name=name, price_cents=cents)
    db.add(product)
    db.flush()
    db.add(ProductPrice(product_id=product.id, period=BASE_PERIOD, price_cents=cents))
    audit(db, request, principal.login, principal.role_label, "додано товар", f"{name} · {money(cents)}")
    db.commit()
    db.refresh(product)
    return _product_dto(db, product)


@router.put("/admin/products/{pid}/price", response_model=ProductDTO)
def update_product_price(
    pid: int,
    payload: dict,
    request: Request,
    principal: Principal = Depends(require(CATALOG_MANAGE)),
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
            db, request, principal.login, principal.role_label, "змінено ціну товару",
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
    principal: Principal = Depends(require(CATALOG_MANAGE)),
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
            db, request, principal.login, principal.role_label, "змінено ціну товару",
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
        audit(db, request, principal.login, principal.role_label, "змінено товар", f"{name} · " + "; ".join(changed))
    db.commit()
    db.refresh(product)
    return _product_dto(db, product, _product_usage(db).get(pid, 0))


@router.delete("/admin/products/{pid}", response_model=MutationDTO)
def delete_product(
    pid: int,
    request: Request,
    principal: Principal = Depends(require(CATALOG_MANAGE)),
    db: Session = Depends(get_db),
) -> MutationDTO:
    product = db.get(Product, pid)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не знайдено.")
    used = db.scalar(select(func.count(ReportItem.id)).where(ReportItem.product_id == pid)) or 0
    if used:
        product.archived, product.active = True, False
        audit(db, request, principal.login, principal.role_label, "архівовано товар", f"{product.name} · рядків у звітах: {used}")
        db.commit()
        return MutationDTO(id=pid, archived=True, message=f"«{product.name}» переміщено в архів. Дані звітів збережено.")
    backup_db("before-delete")
    name = product.name
    db.execute(delete(ProductPrice).where(ProductPrice.product_id == pid))
    db.execute(delete(Product).where(Product.id == pid))
    audit(db, request, principal.login, principal.role_label, "видалено товар", name)
    db.commit()
    return MutationDTO(id=pid, deleted=True, message=f"Товар «{name}» остаточно видалено.")


@router.post("/admin/products/{pid}/restore", response_model=ProductDTO)
def restore_product(
    pid: int,
    request: Request,
    principal: Principal = Depends(require(CATALOG_MANAGE)),
    db: Session = Depends(get_db),
) -> ProductDTO:
    product = db.get(Product, pid)
    if not product:
        raise HTTPException(status_code=404, detail="Товар не знайдено.")
    product.archived, product.active = False, True
    audit(db, request, principal.login, principal.role_label, "відновлено товар", product.name)
    db.commit()
    db.refresh(product)
    return _product_dto(db, product, _product_usage(db).get(pid, 0))


# --- Store: monthly report ---------------------------------------------------

@router.get("/store/reports/{period}", response_model=StoreReportDTO)
def read_store_report(
    period: str,
    principal: Principal = Depends(require_member(SUBMIT)),
    db: Session = Depends(get_db),
) -> StoreReportDTO:
    selected = parse_period(period)
    known = store_periods(db, principal.organisation_id)
    if selected != current_period() and selected not in known:
        raise HTTPException(status_code=404, detail=f"Звіту за {selected} немає.")
    report = find_report(db, principal.organisation_id, selected)
    return _store_report_dto(db, principal, selected, report)


@router.put("/store/reports/{period}", response_model=StoreReportDTO)
def save_store_report(
    period: str,
    payload: ReportSaveDTO,
    request: Request,
    principal: Principal = Depends(require_member(SUBMIT)),
    db: Session = Depends(get_db),
) -> StoreReportDTO:
    selected = parse_period(period)
    known = store_periods(db, principal.organisation_id)
    if selected != current_period() and selected not in known:
        raise HTTPException(status_code=403, detail=f"Звіту за {selected} не існує.")
    report = find_report(db, principal.organisation_id, selected)
    if report and report.status == "submitted":
        raise HTTPException(status_code=409, detail="Звіт надіслано й заблоковано адміністратором.")

    if not report:
        report = Report(store_id=principal.organisation_id, period=selected, status="draft")
        db.add(report)
        db.flush()

    history = load_history(db)
    allowed: dict[int, set[int]] = {}
    for product in db.scalars(select(Product).where(Product.active, Product.archived.is_(False))):
        allowed[product.id] = set(offered_prices(history_of(history, product), selected))
    existing_calc: dict[tuple[int, int], int] = defaultdict(int)
    for item in report.items:
        if item.product_id in allowed and (item.quantity > 0 or item.quantity_calc > 0):
            allowed[item.product_id].add(item.unit_price_cents)
        existing_calc[item.product_id, item.unit_price_cents] += item.quantity_calc

    seen: set[tuple[int, int]] = set()
    quantities: dict[int, dict[int, tuple[int, int]]] = defaultdict(dict)
    for line in payload.quantities:
        key = (line.product_id, line.price_cents)
        if key in seen:
            raise HTTPException(status_code=422, detail="Повторюється рядок товару/ціни.")
        seen.add(key)
        calculation_quantity = (
            line.quantity_calc
            if line.quantity_calc is not None
            else existing_calc.get(key, 0)
        )
        if line.quantity == 0 and calculation_quantity == 0:
            continue
        if line.price_cents not in allowed.get(line.product_id, set()):
            raise HTTPException(
                status_code=409,
                detail="Список товарів або ціни змінилися. Оновіть звіт і повторіть збереження.",
            )
        quantities[line.product_id][line.price_cents] = (
            line.quantity,
            calculation_quantity,
        )

    # Rows of inactive/archived products are read-only in the UI and stay untouched.
    replace_editable_items(db, report, set(allowed), quantities)
    submitting = payload.action == "submit"
    report.status = "submitted" if submitting else "draft"
    audit(
        db, request, principal.login, principal.role_label,
        "надіслано звіт" if submitting else "збережено звіт",
        f"{principal.user.organisation.name if principal.user.organisation else principal.login} · {selected}",
    )
    db.commit()
    db.refresh(report)
    return _store_report_dto(db, principal, selected, report)


# --- Review: submitted reports and monthly summary -------------------------

@router.get("/admin/reports", response_model=list[AdminReportListItemDTO])
def list_admin_reports(
    period: str | None = None,
    _: Principal = Depends(require(REVIEW)),
    db: Session = Depends(get_db),
) -> list[AdminReportListItemDTO]:
    selected = parse_period(period)
    reports_by_store = {
        report.store_id: report
        for report in db.scalars(select(Report).where(Report.period == selected))
    }
    result = []
    for store in db.scalars(select(Organisation).order_by(Organisation.name)):
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
    principal: Principal = Depends(require(REVIEW)),
    db: Session = Depends(get_db),
) -> AdminReportDetailDTO:
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(status_code=404, detail="Звіт не знайдено.")
    rows, inactive, inactive_total = build_lines(
        db,
        report.period,
        report.items,
        calculation_enabled=calculation_enabled(db, report.store_id),
    )
    return AdminReportDetailDTO(
        report_id=report.id,
        store_id=report.store_id,
        store_name=report.store.name if report.store else "?",
        store_archived=bool(report.store and report.store.archived),
        calculation_enabled=calculation_enabled(db, report.store_id),
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
    principal: Principal = Depends(require(REVIEW)),
    db: Session = Depends(get_db),
) -> AdminReportDTO:
    target = payload.status
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(status_code=404, detail="Звіт не знайдено.")
    report.status = target
    store = report.store
    audit(
        db, request, principal.login, principal.role_label,
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
        calculation_enabled=calculation_enabled(db, report.store_id),
        period=report.period,
        status=report.status,
        total_cents=report_total(report),
        item_count=len(report.items),
    )


@router.get("/admin/summary", response_model=SummaryDTO)
def read_admin_summary(
    period: str | None = None,
    submitted_only: bool = False,
    _: Principal = Depends(require(REVIEW)),
    db: Session = Depends(get_db),
) -> SummaryDTO:
    selected = parse_period(period)
    stores, rows, totals, grand = build_summary(db, selected, submitted_only)
    return SummaryDTO(
        period=selected,
        submitted_only=submitted_only,
        stores=[
            SummaryStoreDTO(
                id=store.id,
                name=store.name,
                archived=store.archived,
                calculation_enabled=store.calculation_enabled,
            )
            for store in stores
        ],
        rows=[
            SummaryRowDTO(
                name=row["name"],
                note=row["note"],
                price_cents=row["price"],
                label=row["label"],
                cells=row["cells"],
                calculation_cells=row["calculation_cells"],
                quantity=row["qty"],
                calculation_quantity=row["calc_qty"],
                sum_cents=row["sum"],
            )
            for row in rows
        ],
        store_totals_cents=totals,
        grand_total_cents=grand,
    )


@router.get("/admin/summary.xlsx")
def export_summary_xlsx(
    period: str | None = None,
    submitted_only: bool = False,
    _: Principal = Depends(require(REVIEW)),
    db: Session = Depends(get_db),
):
    selected = parse_period(period)
    stream = generate_summary_excel(db, selected, submitted_only)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="zvit-{selected}.xlsx"'},
    )


# --- Per-organisation report settings ----------------------------------------


def _settings_dto(org: Organisation, enabled: set[int], counts: dict[int, int]) -> ReportSettingsDTO:
    return ReportSettingsDTO(
        organisation_id=org.id,
        organisation_name=org.name,
        archived=org.archived,
        calculation_enabled=org.id in enabled,
        reports_count=counts.get(org.id, 0),
    )


@router.get("/reports/settings", response_model=list[ReportSettingsDTO])
def list_report_settings(
    _: Principal = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> list[ReportSettingsDTO]:
    enabled, counts = calculation_enabled_ids(db), reports_per_organisation(db)
    orgs = db.scalars(select(Organisation)).all()
    return [_settings_dto(o, enabled, counts) for o in sorted(orgs, key=lambda o: o.name.casefold())]


@router.put("/reports/settings/{oid}", response_model=ReportSettingsDTO)
def update_report_settings(
    oid: int,
    payload: ReportSettingsUpdateDTO,
    request: Request,
    principal: Principal = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> ReportSettingsDTO:
    org = db.get(Organisation, oid)
    if not org:
        raise HTTPException(status_code=404, detail="Організацію не знайдено.")
    if calculation_enabled(db, oid) != payload.calculation_enabled:
        set_calculation_enabled(db, oid, payload.calculation_enabled)
        state = "увімкнено" if payload.calculation_enabled else "вимкнено"
        audit(db, request, principal.login, principal.role_label, "змінено налаштування звітів",
              f"{org.name}: режим «По розрахунку» {state}")
        db.commit()
    return _settings_dto(org, calculation_enabled_ids(db), reports_per_organisation(db))
