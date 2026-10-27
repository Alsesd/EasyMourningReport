"""Report construction, lines calculation, and summary queries."""

from collections import defaultdict

from sqlmodel import select
from sqlmodel import Session

from app.core.periods import money
from app.db.models.product import Product
from app.db.models.report import Report, ReportItem
from app.db.models.store import Store
from app.db.repositories.products import history_of, in_form, load_history
from app.services.pricing import line_labels, offered_prices


def find_report(db: Session, store_id: int, period: str) -> Report | None:
    return db.scalar(
        select(Report).where(Report.store_id == store_id, Report.period == period)
    )


def report_total(r: Report) -> int:
    """Financial totals use the ordinary reported quantity, never the calculation quantity."""
    return sum(i.quantity * i.unit_price_cents for i in r.items)


def build_lines(
    db: Session,
    period: str,
    items: list[ReportItem],
    calculation_enabled: bool = True,
):
    """Build report lines for a period, keeping the two quantities independent."""
    history = load_history(db)
    saved: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    saved_calc: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for it in items:
        saved[it.product_id][it.unit_price_cents] += it.quantity
        saved_calc[it.product_id][it.unit_price_cents] += it.quantity_calc

    rows, inactive = [], []
    for p in db.scalars(select(Product).order_by(Product.name)):
        sp = saved.get(p.id, {})
        cp = saved_calc.get(p.id, {})
        if in_form(p):
            derived = offered_prices(history_of(history, p), period)
            extra = sorted(
                pr for pr in set(sp) | set(cp)
                if pr not in derived and (sp.get(pr, 0) > 0 or cp.get(pr, 0) > 0)
            )
            inputs = [
                {
                    "price": pr,
                    "qty": sp.get(pr, 0),
                    "qty_calc": cp.get(pr, 0),
                    "label": label,
                }
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
            prices = sorted(
                pr for pr in set(sp) | set(cp)
                if sp.get(pr, 0) > 0 or cp.get(pr, 0) > 0
            )
            if prices:
                line_parts = []
                for pr in prices:
                    quantity = sp.get(pr, 0)
                    calc_quantity = cp.get(pr, 0)
                    if quantity:
                        line_parts.append(f"{quantity} × {money(pr)}")
                    if calculation_enabled and calc_quantity:
                        line_parts.append(f"по розрахунку: {calc_quantity} × {money(pr)}")
                if line_parts:
                    inactive.append(
                        {
                            "name": p.name,
                            "archived": p.archived,
                            "lines": "; ".join(line_parts),
                            "sum": sum(pr * q for pr, q in sp.items()),
                        }
                    )
    return rows, inactive, sum(r["sum"] for r in inactive)


def build_summary(db: Session, period: str, submitted_only: bool = False):
    q = (
        select(
            Report.store_id,
            ReportItem.product_id,
            ReportItem.quantity,
            ReportItem.quantity_calc,
            ReportItem.unit_price_cents,
        )
        .select_from(ReportItem)
        .join(Report, ReportItem.report_id == Report.id)
        .where(Report.period == period)
    )
    if submitted_only:
        q = q.where(Report.status == "submitted")

    qty, calc_qty, amt = defaultdict(int), defaultdict(int), defaultdict(int)
    enabled_store_ids = set(
        db.scalars(select(Store.id).where(Store.calculation_enabled))
    )
    data_pids, data_sids, data_prices = set(), set(), defaultdict(set)
    for sid, pid, n, calc_n, price in db.execute(q):
        qty[pid, price, sid] += n
        calc_qty[pid, price, sid] += calc_n
        amt[pid, price, sid] += n * price
        if n or (calc_n and sid in enabled_store_ids):
            data_pids.add(pid)
            data_sids.add(sid)
            data_prices[pid].add(price)

    # Archived stores / switched-off products stay in the table only for months where they have data.
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
        # Keep quantities assigned to each actual saved unit price.
        for price in prices:
            cells = [qty[p.id, price, s.id] for s in stores]
            calculation_cells = [
                calc_qty[p.id, price, s.id] if s.calculation_enabled else 0
                for s in stores
            ]
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
                    if len(offered) >= 2 or label_by_price.get(price) == "saved"
                    else "",
                    "price": price,
                    "label": label_by_price.get(price, ""),
                    "cells": cells,
                    "calculation_cells": calculation_cells,
                    "qty": sum(cells),
                    "calc_qty": sum(calculation_cells),
                    "sum": sum(amt[p.id, price, s.id] for s in stores),
                }
            )
    store_sums = [
        sum(amt[pid, price, s.id] for pid in data_pids for price in data_prices[pid])
        for s in stores
    ]
    return stores, rows, store_sums, sum(store_sums)
