"""Report construction, lines calculation, and summary queries."""

from collections import defaultdict

from sqlmodel import select
from sqlmodel import Session

from app.core.ui import money
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
    return sum(i.quantity * i.unit_price_cents for i in r.items)


def build_lines(db: Session, period: str, items: list[ReportItem]):
    """Lines of one store's report for `period`.

    Returns (rows, inactive, inactive_total). `rows` are the active products with their price lines (two lines in
    the month a price changed), `inactive` are saved quantities of products that are switched off or archived.
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
            extra = sorted(pr for pr, q in sp.items() if q > 0 and pr not in derived)
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
                        "lines": "; ".join(f"{q} × {money(pr)}" for pr, q in lines),
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
        # Keep unusual previously-saved prices too, just as an individual store report does.
        prices = list(offered) + sorted(
            pr for pr in data_prices[p.id] if pr not in offered
        )
        labels = line_labels(
            offered, sorted(pr for pr in data_prices[p.id] if pr not in offered)
        )
        label_by_price = {price: label for price, label in labels}
        # A changed product gets one merged-report row per price (old and new), with quantities
        # split by the actual unit price saved by each store instead of combined into one row.
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
                    if len(offered) >= 2 or label_by_price.get(price) == "saved"
                    else "",
                    "price": price,
                    "label": label_by_price.get(price, ""),
                    "cells": cells,
                    "qty": sum(cells),
                    "sum": sum(amt[p.id, price, s.id] for s in stores),
                }
            )
    store_sums = [
        sum(amt[pid, price, s.id] for pid in data_pids for price in data_prices[pid])
        for s in stores
    ]
    return stores, rows, store_sums, sum(store_sums)
