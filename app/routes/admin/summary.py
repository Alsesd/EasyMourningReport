"""Admin monthly summary page and Excel export."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core import admin_period, admin_required, get_db, parse_period, render
from app.db import User
from app.db.repositories import build_summary
from app.services import generate_summary_excel

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
