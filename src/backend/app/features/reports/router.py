"""Reports and monthly summary REST API endpoints and Excel download."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.core.database import get_db
from app.core.validation import parse_period
from app.features.auth.dependencies import (
    api_admin_required,
    api_store_required,
)
from app.features.auth.models import User
from app.features.reports.schemas import (
    AdminReportDetailDTO,
    AdminReportDTO,
    AdminReportListItemDTO,
    ReportSaveDTO,
    ReportStatusDTO,
    StoreReportDTO,
    SummaryDTO,
)
from app.features.reports.service import (
    generate_summary_excel,
    get_admin_report_detail,
    get_admin_summary,
    get_store_report,
    list_admin_reports,
    save_store_report,
    update_admin_report_status,
)

router = APIRouter(tags=["Reports"])


@router.get("/store/reports/{period}", response_model=StoreReportDTO)
def read_store_report(
    period: str,
    user: User = Depends(api_store_required),
    db: Session = Depends(get_db),
) -> StoreReportDTO:
    return get_store_report(db, user, period)


@router.put("/store/reports/{period}", response_model=StoreReportDTO)
def api_save_store_report(
    period: str,
    payload: ReportSaveDTO,
    request: Request,
    user: User = Depends(api_store_required),
    db: Session = Depends(get_db),
) -> StoreReportDTO:
    return save_store_report(db, user, period, payload, request)


@router.get("/admin/reports", response_model=list[AdminReportListItemDTO])
def api_list_admin_reports(
    period: str | None = None,
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> list[AdminReportListItemDTO]:
    return list_admin_reports(db, period)


@router.get("/admin/reports/{rid}", response_model=AdminReportDetailDTO)
def api_read_admin_report(
    rid: int,
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> AdminReportDetailDTO:
    return get_admin_report_detail(db, rid)


@router.patch("/admin/reports/{rid}", response_model=AdminReportDTO)
def api_update_admin_report_status(
    rid: int,
    payload: ReportStatusDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> AdminReportDTO:
    return update_admin_report_status(db, rid, payload, user, request)


@router.get("/admin/summary", response_model=SummaryDTO)
def api_read_admin_summary(
    period: str | None = None,
    submitted_only: bool = False,
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> SummaryDTO:
    return get_admin_summary(db, period, submitted_only)


# Excel workbook download route: mounted at root level (/admin/summary.xlsx)
summary_xlsx_router = APIRouter(prefix="/admin/summary")


@summary_xlsx_router.get(".xlsx")
def summary_xlsx(
    period: str | None = None,
    submitted_only: bool = False,
    _user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
):
    selected = parse_period(period)
    stream = generate_summary_excel(db, selected, submitted_only)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="zvit-{selected}.xlsx"'
        },
    )


__all__ = ["router", "summary_xlsx", "summary_xlsx_router"]
