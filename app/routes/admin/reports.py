"""Admin report inspection and status toggle endpoints."""

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from app.core.dependencies import admin_period, admin_required
from app.core.ui import done, render
from app.db.models.report import Report
from app.db.models.store import Store
from app.db.models.user import User
from app.db.repositories.audit import audit
from app.db.repositories.reports import build_lines, report_total
from app.db.session import get_db
from sqlmodel import select
from sqlmodel import Session


router = APIRouter()


@router.get("")
def reports_page(
    request: Request,
    period: str | None = None,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    period = admin_period(request, period)
    reports = {
        r.store_id: r
        for r in db.scalars(select(Report).where(Report.period == period))
    }
    rows = [
        {
            "store": s,
            "report": reports.get(s.id),
            "total": report_total(reports[s.id]) if s.id in reports else 0,
        }
        for s in db.scalars(select(Store).order_by(Store.name))
        if not s.archived or s.id in reports
    ]
    return render(
        request, "reports.html", {"user": user, "period": period, "rows": rows}
    )


@router.get("/{rid}")
def report_view(
    rid: int,
    request: Request,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    report = db.get(Report, rid)
    if not report:
        raise HTTPException(404)
    request.session["period"] = report.period  # the tabs keep showing this month
    rows, inactive, inactive_total = build_lines(db, report.period, report.items)
    lines = [
        {
            "name": r["name"],
            "label": i["label"],
            "price": i["price"],
            "qty": i["qty"],
            "sum": i["qty"] * i["price"],
        }
        for r in rows
        for i in r["inputs"]
        if i["qty"] or r["repriced"]
    ]
    ctx = {
        "user": user,
        "report": report,
        "period": report.period,
        "lines": lines,
        "inactive_rows": inactive,
        "total": report_total(report),
    }
    return render(request, "report_view.html", ctx)


@router.post("/{rid}/status")
def report_status(
    request: Request,
    rid: int,
    status: str = Form(),
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    report = db.get(Report, rid)
    if not report or status not in ("draft", "submitted"):
        raise HTTPException(400, "Некоректний запит")
    report.status = status
    audit(
        db,
        request,
        user.login,
        user.role,
        "заблоковано звіт" if status == "submitted" else "розблоковано звіт",
        f"{report.store.name if report.store else '?'} · {report.period}",
    )
    db.commit()
    return done(
        request,
        f"/admin/reports/{rid}",
        "Звіт заблоковано: магазин більше не може його змінити."
        if status == "submitted"
        else "Звіт розблоковано: магазин може його редагувати й надіслати знову.",
    )
