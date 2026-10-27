"""Monthly sales reports, line calculation engine, summary builder, and Excel export."""

from __future__ import annotations

import copy
import io
from collections import defaultdict
from typing import TYPE_CHECKING

from fastapi import HTTPException, Request
from openpyxl import Workbook
from sqlmodel import Session, func, select

from app.core.ui import current_period, money
from app.core.validation import parse_period
from app.features.audit.service import record_audit
from app.features.products.models import Product
from app.features.products.service import (
    history_of,
    in_form,
    line_labels,
    load_history,
    offered_prices,
)
from app.features.reports.models import Report, ReportItem
from app.features.reports.schemas import (
    AdminReportDetailDTO,
    AdminReportDTO,
    AdminReportListItemDTO,
    InactiveReportLineDTO,
    ReportInputDTO,
    ReportLineDTO,
    ReportSaveDTO,
    ReportStatusDTO,
    StoreReportDTO,
    SummaryDTO,
    SummaryRowDTO,
    SummaryStoreDTO,
)
from app.features.stores.models import Store

if TYPE_CHECKING:
    from app.features.auth.models import User


def find_report(db: Session, store_id: int, period: str) -> Report | None:
    return db.scalar(
        select(Report).where(
            Report.store_id == store_id, Report.period == period
        )
    )


def report_total(r: Report) -> int:
    return sum(i.quantity * i.unit_price_cents for i in r.items)


# Interface contracts for Products and Stores


def count_product_reports(db: Session, product_id: int) -> int:
    """Number of report items referencing a product."""
    return (
        db.scalar(
            select(func.count(ReportItem.id)).where(
                ReportItem.product_id == product_id
            )
        )
        or 0
    )


def get_product_report_counts(db: Session) -> dict[int, int]:
    """Map of product_id -> number of report items."""
    return {
        pid: count
        for pid, count in db.execute(
            select(ReportItem.product_id, func.count(ReportItem.id)).group_by(
                ReportItem.product_id
            )
        )
    }


def count_store_reports(db: Session, store_id: int) -> int:
    """Number of reports filed by a store."""
    return (
        db.scalar(
            select(func.count(Report.id)).where(Report.store_id == store_id)
        )
        or 0
    )


def get_store_report_counts(db: Session) -> dict[int, int]:
    """Map of store_id -> number of reports."""
    return {
        sid: count
        for sid, count in db.execute(
            select(Report.store_id, func.count(Report.id)).group_by(
                Report.store_id
            )
        )
    }


def store_periods(db: Session, store_id: int) -> set[str]:
    return set(
        db.scalars(select(Report.period).where(Report.store_id == store_id))
    )


# Calculations


def build_lines(db: Session, period: str, items: list[ReportItem]):
    """Lines of one store's report for `period`.

    Returns (rows, inactive, inactive_total). `rows` are the active products with their price lines,
    `inactive` are saved quantities of products that are switched off or archived.
    """
    history = load_history(db)
    saved: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for it in items:
        saved[it.product_id][it.unit_price_cents] += it.quantity
    rows, inactive = [], []
    for p in db.scalars(select(Product).order_by(Product.name)):
        sp = saved.get(p.id, {})
        if in_form(p):
            derived = offered_prices(history_of(history, p), period)
            extra = sorted(
                pr for pr, q in sp.items() if q > 0 and pr not in derived
            )
            inputs = [
                {"price": pr, "qty": sp.get(pr, 0), "label": label}
                for pr, label in line_labels(derived, extra)
            ]
            rows.append(
                {
                    "id": p.id,
                    "name": p.name,
                    "inputs": inputs,
                    "repriced": len(derived) > 1,
                    "sum": sum(i["price"] * i["qty"] for i in inputs),
                }
            )
        else:
            lines = sorted((pr, q) for pr, q in sp.items() if q > 0)
            if lines:
                inactive.append(
                    {
                        "name": p.name,
                        "archived": p.archived,
                        "lines": "; ".join(
                            f"{q} × {money(pr)}" for pr, q in lines
                        ),
                        "sum": sum(pr * q for pr, q in lines),
                    }
                )
    return rows, inactive, sum(r["sum"] for r in inactive)


def build_summary(db: Session, period: str, submitted_only: bool = False):
    q = (
        select(
            Report.store_id,
            ReportItem.product_id,
            ReportItem.quantity,
            ReportItem.unit_price_cents,
        )
        .select_from(ReportItem)
        .join(Report, ReportItem.report_id == Report.id)
        .where(Report.period == period)
    )
    if submitted_only:
        q = q.where(Report.status == "submitted")
    qty, amt = defaultdict(int), defaultdict(int)
    data_pids, data_sids, data_prices = set(), set(), defaultdict(set)
    for sid, pid, n, price in db.execute(q):
        qty[pid, price, sid] += n
        amt[pid, price, sid] += n * price
        if n:
            data_pids.add(pid)
            data_sids.add(sid)
            data_prices[pid].add(price)

    stores = [
        s
        for s in db.scalars(select(Store).order_by(Store.name))
        if not s.archived or s.id in data_sids
    ]
    products = [
        p
        for p in db.scalars(select(Product).order_by(Product.name))
        if in_form(p) or p.id in data_pids
    ]
    history = load_history(db)
    rows = []
    for p in products:
        offered = offered_prices(history_of(history, p), period)
        prices = list(offered) + sorted(
            pr for pr in data_prices[p.id] if pr not in offered
        )
        labels = line_labels(
            offered, sorted(pr for pr in data_prices[p.id] if pr not in offered)
        )
        label_by_price = {price: label for price, label in labels}
        for price in prices:
            cells = [qty[p.id, price, s.id] for s in stores]
            rows.append(
                {
                    "name": p.name,
                    "note": (
                        f"{money(price)} · "
                        + {
                            "old": "стара ціна",
                            "new": "нова ціна",
                            "saved": "раніше збережена",
                        }.get(label_by_price.get(price), "ціна")
                    )
                    if len(offered) >= 2
                    or label_by_price.get(price) == "saved"
                    else "",
                    "price": price,
                    "label": label_by_price.get(price, ""),
                    "cells": cells,
                    "qty": sum(cells),
                    "sum": sum(amt[p.id, price, s.id] for s in stores),
                }
            )
    store_sums = [
        sum(
            amt[pid, price, s.id]
            for pid in data_pids
            for price in data_prices[pid]
        )
        for s in stores
    ]
    return stores, rows, store_sums, sum(store_sums)


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


def get_store_report(
    db: Session, user: User, period: str
) -> StoreReportDTO:
    selected = parse_period(period)
    known = store_periods(db, user.store_id)
    if selected != current_period() and selected not in known:
        raise HTTPException(
            status_code=404, detail=f"Звіту за {selected} немає."
        )
    report = find_report(db, user.store_id, selected)
    rows, inactive, inactive_total = build_lines(
        db, selected, report.items if report else []
    )
    return StoreReportDTO(
        report_id=report.id if report else None,
        store_name=user.store.name if user.store else user.login,
        period=selected,
        status=report.status if report else "new",
        read_only=bool(report and report.status == "submitted"),
        rows=_report_line_dtos(rows),
        inactive_rows=_inactive_line_dtos(inactive),
        inactive_total_cents=inactive_total,
        total_cents=sum(row["sum"] for row in rows) + inactive_total,
        available_periods=sorted(known | {current_period()}),
    )


def save_store_report(
    db: Session,
    user: User,
    period: str,
    payload: ReportSaveDTO,
    request: Request,
) -> StoreReportDTO:
    selected = parse_period(period)
    known = store_periods(db, user.store_id)
    if selected != current_period() and selected not in known:
        raise HTTPException(
            status_code=403, detail=f"Звіту за {selected} не існує."
        )
    report = find_report(db, user.store_id, selected)
    if report and report.status == "submitted":
        raise HTTPException(
            status_code=409,
            detail="Звіт надіслано й заблоковано адміністратором.",
        )

    if not report:
        report = Report(
            store_id=user.store_id, period=selected, status="draft"
        )
        db.add(report)
        db.flush()

    history = load_history(db)
    allowed: dict[int, set[int]] = {}
    for product in db.scalars(
        select(Product).where(Product.active, Product.archived.is_(False))
    ):
        allowed[product.id] = set(
            offered_prices(history_of(history, product), selected)
        )
    for item in report.items:
        if item.product_id in allowed and item.quantity > 0:
            allowed[item.product_id].add(item.unit_price_cents)

    seen: set[tuple[int, int]] = set()
    quantities: dict[int, dict[int, int]] = defaultdict(dict)
    for line in payload.quantities:
        key = (line.product_id, line.price_cents)
        if key in seen:
            raise HTTPException(
                status_code=422, detail="Повторюється рядок товару/ціни."
            )
        seen.add(key)
        if line.quantity == 0:
            continue
        if line.price_cents not in allowed.get(line.product_id, set()):
            raise HTTPException(
                status_code=409,
                detail="Список товарів або ціни змінилися. Оновіть звіт і повторіть збереження.",
            )
        quantities[line.product_id][line.price_cents] = line.quantity

    preserved = [
        item for item in report.items if item.product_id not in allowed
    ]
    new_items = list(preserved)
    for product_id in allowed:
        for price, quantity in quantities.get(product_id, {}).items():
            new_items.append(
                ReportItem(
                    product_id=product_id,
                    quantity=quantity,
                    unit_price_cents=price,
                )
            )
    report.items = new_items
    submitting = payload.action == "submit"
    report.status = "submitted" if submitting else "draft"
    record_audit(
        db,
        request,
        user.login,
        user.role,
        "надіслано звіт" if submitting else "збережено звіт",
        f"{user.store.name if user.store else user.login} · {selected}",
    )
    db.commit()
    db.refresh(report)
    return get_store_report(db, user, selected)


def list_admin_reports(
    db: Session, period: str | None = None
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


def get_admin_report_detail(
    db: Session, rid: int
) -> AdminReportDetailDTO:
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(status_code=404, detail="Звіт не знайдено.")
    rows, inactive, inactive_total = build_lines(
        db, report.period, report.items
    )
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


def update_admin_report_status(
    db: Session,
    rid: int,
    payload: ReportStatusDTO,
    user: User,
    request: Request,
) -> AdminReportDTO:
    target = payload.status
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(status_code=404, detail="Звіт не знайдено.")
    report.status = target
    store = report.store
    record_audit(
        db,
        request,
        user.login,
        user.role,
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


def get_admin_summary(
    db: Session, period: str | None = None, submitted_only: bool = False
) -> SummaryDTO:
    selected = parse_period(period)
    stores, rows, totals, grand = build_summary(db, selected, submitted_only)
    return SummaryDTO(
        period=selected,
        submitted_only=submitted_only,
        stores=[
            SummaryStoreDTO(
                id=store.id, name=store.name, archived=store.archived
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
                quantity=row["qty"],
                sum_cents=row["sum"],
            )
            for row in rows
        ],
        store_totals_cents=totals,
        grand_total_cents=grand,
    )


def generate_summary_excel(
    db: Session, period: str, submitted_only: bool = False
) -> io.BytesIO:
    """Generate Excel matrix workbook of monthly report summary."""
    stores, rows, store_sums, grand = build_summary(db, period, submitted_only)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Звіт"
    sheet.append(["Назва", "Ціна", "Звітована кількість", "Сума"])
    for row in rows:
        sheet.append(
            [row["name"], row["price"] / 100, row["qty"], row["sum"] / 100]
        )
    sheet.append(
        ["Разом", None, sum(row["qty"] for row in rows), grand / 100]
    )
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = (
        f"A1:D{sheet.max_row - 1}" if sheet.max_row > 1 else "A1:D1"
    )
    sheet.column_dimensions["A"].width = 36
    sheet.column_dimensions["B"].width = 16
    sheet.column_dimensions["C"].width = 24
    sheet.column_dimensions["D"].width = 18
    for cell in sheet["B"][1:] + sheet["D"][1:]:
        cell.number_format = "#,##0.00"
    for cell in sheet[1]:
        font = copy.copy(cell.font)
        font.bold = True
        cell.font = font
    for cell in sheet[sheet.max_row]:
        font = copy.copy(cell.font)
        font.bold = True
        cell.font = font
    out = io.BytesIO()
    workbook.save(out)
    out.seek(0)
    return out


__all__ = [
    "build_lines",
    "build_summary",
    "count_product_reports",
    "count_store_reports",
    "find_report",
    "generate_summary_excel",
    "get_admin_report_detail",
    "get_admin_summary",
    "get_product_report_counts",
    "get_store_report",
    "get_store_report_counts",
    "list_admin_reports",
    "report_total",
    "save_store_report",
    "store_periods",
    "update_admin_report_status",
]
