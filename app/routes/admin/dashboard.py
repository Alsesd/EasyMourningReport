"""Admin dashboard: settings and management overview."""

from fastapi import APIRouter, Depends, Request
from app.core.dependencies import admin_required
from app.core.ui import current_period, render
from app.db.models.product import Product
from app.db.models.report import Report, ReportItem
from app.db.models.user import User
from app.db.repositories.products import history_of, load_history
from app.db.session import get_db
from app.services.pricing import offered_prices
from sqlalchemy import func, select
from sqlmodel import Session


router = APIRouter()


@router.get("")
def admin_page(
    request: Request,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    period = current_period()
    history = load_history(db)
    used = {
        pid: n
        for pid, n in db.execute(
            select(ReportItem.product_id, func.count(ReportItem.id)).group_by(
                ReportItem.product_id
            )
        )
    }
    reports = {
        sid: n
        for sid, n in db.execute(
            select(Report.store_id, func.count(Report.id)).group_by(
                Report.store_id
            )
        )
    }
    products, inactive_products, archived_products = [], [], []
    for p in db.scalars(select(Product).order_by(Product.name)):
        if p.archived:
            archived_products.append({"p": p, "used": used.get(p.id, 0)})
            continue
        lines = offered_prices(history_of(history, p), period)
        item = {
            "p": p,
            "used": used.get(p.id, 0),
            "prev": lines[0],
            "change": (lines[0], lines[1]) if len(lines) == 2 else None,
            "changes": lines,
        }
        (products if p.active else inactive_products).append(item)
    stores, archived_stores = [], []
    for u in db.scalars(
        select(User).where(User.role == "store").order_by(User.login)
    ):
        if not u.store:
            continue
        x = {"store": u.store, "user": u, "reports": reports.get(u.store_id, 0)}
        (archived_stores if u.store.archived else stores).append(x)
    stores.sort(key=lambda x: x["store"].name)
    archived_stores.sort(key=lambda x: x["store"].name)
    ctx = {
        "user": user,
        "products": products,
        "inactive_products": inactive_products,
        "archived_products": archived_products,
        "stores": stores,
        "archived_stores": archived_stores,
    }
    return render(request, "admin.html", ctx)
