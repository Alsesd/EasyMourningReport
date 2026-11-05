"""Product repository and price-history data access."""

from collections import defaultdict

from sqlmodel import select
from sqlmodel import Session

from app.db.models.product import Product, ProductPrice
from app.services.pricing import BASE_PERIOD, History, sort_history


def load_history(db: Session) -> dict[int, History]:
    """product id -> [(period, price_cents), ...] sorted by period."""
    out: dict[int, History] = defaultdict(list)
    q = select(
        ProductPrice.product_id, ProductPrice.period, ProductPrice.price_cents
    ).order_by(ProductPrice.period)
    for pid, period, cents in db.execute(q):
        out[pid].append((period, cents))
    return {pid: sort_history(history) for pid, history in out.items()}


def history_of(history: dict[int, History], p: Product) -> History:
    return sort_history(history.get(p.id) or [(BASE_PERIOD, p.price_cents)])


def in_form(p: Product) -> bool:
    """Products that appear in new report forms."""
    return p.active and not p.archived


def save_history(db: Session, pid: int, new: History) -> None:
    rows = {
        r.period: r
        for r in db.scalars(select(ProductPrice).where(ProductPrice.product_id == pid))
    }
    wanted = dict(new)
    for period, row in rows.items():
        if period in wanted:
            row.price_cents = wanted[period]
        else:
            db.delete(row)
    for period, cents in wanted.items():
        if period not in rows:
            db.add(ProductPrice(product_id=pid, period=period, price_cents=cents))
