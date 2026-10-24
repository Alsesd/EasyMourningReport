"""Admin monthly summary Excel export."""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.core.dependencies import admin_required, parse_period
from app.db.models.user import User
from app.db.session import get_db
from app.services.excel import generate_summary_excel


router = APIRouter()


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
