"""Admin monthly summary page and Excel export."""

from fastapi import APIRouter, Depends, Request
from app.core.dependencies import admin_period, admin_required, parse_period
from app.core.ui import render
from app.db.models.user import User
from app.db.repositories.reports import build_summary
from app.db.session import get_db
from app.services.excel import generate_summary_excel
from fastapi.responses import StreamingResponse
from sqlmodel import Session


router = APIRouter()


@router.get("")
def summary_page(
    request: Request,
    period: str | None = None,
    submitted_only: bool = False,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    period = admin_period(request, period)
    stores, rows, store_sums, grand = build_summary(db, period, submitted_only)
    ctx = {
        "user": user,
        "period": period,
        "stores": stores,
        "rows": rows,
        "store_sums": store_sums,
        "grand": grand,
        "submitted_only": submitted_only,
    }
    return render(request, "summary.html", ctx)


@router.get(".xlsx")
def summary_xlsx(
    period: str | None = None,
    submitted_only: bool = False,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    period = parse_period(period)
    stream = generate_summary_excel(db, period, submitted_only)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="zvit-{period}.xlsx"'
        },
    )
