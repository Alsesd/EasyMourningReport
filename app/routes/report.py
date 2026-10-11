"""Store monthly report interface (quantities only)."""

import re
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import (
    FormError,
    current_period,
    done,
    get_db,
    parse_period,
    render,
    store_required,
)
from app.db import Product, Report, ReportItem, User
from app.db.repositories import (
    audit,
    build_lines,
    find_report,
    history_of,
    load_history,
    store_periods,
)
from app.services import offered_prices

router = APIRouter()


@router.get("/report")
def report_page(
    request: Request,
    period: str | None = None,
    user: User = Depends(store_required),
    db: Session = Depends(get_db),
):
    period = parse_period(period)
    current = current_period()
    known = store_periods(db, user.store_id)
    if period != current and period not in known:
        return done(
            request,
            "/report",
            f"Звіту за {period} немає. Можна відкрити поточний місяць "
            "або місяці, за які вже подано звіти.",
            "err",
        )
    report = find_report(db, user.store_id, period)
    rows, inactive, inactive_total = build_lines(
        db, period, report.items if report else []
    )
    allowed = sorted(known | {current})
    ctx = {
        "user": user,
        "period": period,
        "rows": rows,
        "inactive_rows": inactive,
        "inactive_total": inactive_total,
        "total": sum(r["sum"] for r in rows) + inactive_total,
        "status": report.status if report else "new",
        "min_period": allowed[0],
        "max_period": allowed[-1],
        "prev_period": max((x for x in allowed if x < period), default=None),
        "next_period": min((x for x in allowed if x > period), default=None),
    }
    return render(request, "report.html", ctx)


@router.post("/report")
async def report_save(
    request: Request,
    user: User = Depends(store_required),
    db: Session = Depends(get_db),
):
    form = await request.form()
    period = parse_period(form.get("period"))
    here = f"/report?period={period}"
    if period != current_period() and period not in store_periods(
        db, user.store_id
    ):
        raise HTTPException(403, "Звіту за цей місяць не існує")
    report = find_report(db, user.store_id, period)
    if report and report.status == "submitted":
        raise FormError(
            "Цей звіт надіслано й заблоковано. Попросіть адміністратора розблокувати його.",
            here,
        )
    if not report:
        report = Report(store_id=user.store_id, period=period, status="draft")
        db.add(report)

    # Which (product, price) lines this report may contain: the prices offered for this month, plus prices that
    # are already saved in it. The server decides - a price coming from the browser is never trusted.
    history = load_history(db)
    allowed: dict[int, set[int]] = {}
    for p in db.scalars(
        select(Product).where(Product.active, Product.archived.is_(False))
    ):
        allowed[p.id] = set(offered_prices(history_of(history, p), period))
    for it in report.items:
        if it.product_id in allowed and it.quantity > 0:
            allowed[it.product_id].add(it.unit_price_cents)

    submitted: dict[int, dict[int, int]] = defaultdict(dict)
    for field, raw in form.multi_items():
        m = re.fullmatch(r"qty_(\d+)_(\d+)", str(field))
        if not m:
            continue
        pid, price_cents = int(m.group(1)), int(m.group(2))
        try:
            qty = int(str(raw).strip() or 0)
        except ValueError:
            raise FormError("Кількість має бути цілим числом", here)
        if qty < 0:
            raise FormError("Кількість не може бути від'ємною", here)
        if not qty:
            continue
        if price_cents not in allowed.get(pid, ()):
            raise FormError(
                "Список товарів або ціни змінилися, поки ви редагували звіт. Нічого не збережено: "
                "перевірте кількості на оновленій сторінці й збережіть ще раз.",
                here,
            )
        submitted[pid][price_cents] = qty
    for pid in allowed:
        if any(i.product_id == pid for i in report.items) or submitted.get(pid):
            report.items = [i for i in report.items if i.product_id != pid]
            for price_cents, qty in submitted.get(pid, {}).items():
                report.items.append(
                    ReportItem(
                        product_id=pid, quantity=qty, unit_price_cents=price_cents
                    )
                )

    submitting = form.get("action") == "submit"
    if submitting:
        report.status = "submitted"
    audit(
        db,
        request,
        user.login,
        user.role,
        "надіслано звіт" if submitting else "збережено звіт",
        f"{user.store.name} · {period}",
    )
    db.commit()
    if submitting:
        return done(
            request,
            here,
            "Звіт надіслано й заблоковано. Змінити його може лише адміністратор: "
            "він має розблокувати звіт.",
        )
    return done(
        request,
        here,
        "Чернетку збережено. Звіт ще не надіслано, його можна редагувати далі.",
    )
