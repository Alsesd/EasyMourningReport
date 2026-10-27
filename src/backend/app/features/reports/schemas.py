"""Typed API schemas for store and admin reports and monthly summaries."""

from typing import Literal

from pydantic import BaseModel, Field

from app.core.schemas import DTO


class ReportInputDTO(DTO):
    price_cents: int
    quantity: int
    label: str = ""
    sum_cents: int


class ReportLineDTO(DTO):
    id: int
    name: str
    repriced: bool
    sum_cents: int
    inputs: list[ReportInputDTO] = Field(default_factory=list)


class InactiveReportLineDTO(DTO):
    name: str
    archived: bool
    lines: str
    sum_cents: int


class ReportQuantityDTO(BaseModel):
    product_id: int = Field(gt=0)
    price_cents: int = Field(ge=0)
    quantity: int = Field(ge=0)


class ReportSaveDTO(BaseModel):
    action: Literal["draft", "submit"] = "draft"
    quantities: list[ReportQuantityDTO] = Field(
        default_factory=list, max_length=5000
    )


class ReportStatusDTO(BaseModel):
    status: Literal["draft", "submitted"]


class StoreReportDTO(DTO):
    report_id: int | None = None
    store_name: str
    period: str
    status: Literal["new", "draft", "submitted"]
    read_only: bool
    rows: list[ReportLineDTO] = Field(default_factory=list)
    inactive_rows: list[InactiveReportLineDTO] = Field(default_factory=list)
    inactive_total_cents: int = 0
    total_cents: int = 0
    available_periods: list[str] = Field(default_factory=list)


class AdminReportListItemDTO(DTO):
    store_id: int
    store_name: str
    store_archived: bool
    report_id: int | None = None
    period: str
    status: Literal["none", "draft", "submitted"]
    total_cents: int = 0
    item_count: int = 0


class AdminReportDTO(DTO):
    report_id: int
    store_id: int
    store_name: str
    store_archived: bool
    period: str
    status: Literal["draft", "submitted"]
    total_cents: int
    item_count: int


class AdminReportDetailDTO(AdminReportDTO):
    rows: list[ReportLineDTO] = Field(default_factory=list)
    inactive_rows: list[InactiveReportLineDTO] = Field(default_factory=list)
    inactive_total_cents: int = 0


class SummaryStoreDTO(DTO):
    id: int
    name: str
    archived: bool


class SummaryRowDTO(DTO):
    name: str
    note: str
    price_cents: int
    label: str
    cells: list[int]
    quantity: int
    sum_cents: int


class SummaryDTO(DTO):
    period: str
    submitted_only: bool
    stores: list[SummaryStoreDTO] = Field(default_factory=list)
    rows: list[SummaryRowDTO] = Field(default_factory=list)
    store_totals_cents: list[int] = Field(default_factory=list)
    grand_total_cents: int


__all__ = [
    "AdminReportDTO",
    "AdminReportDetailDTO",
    "AdminReportListItemDTO",
    "InactiveReportLineDTO",
    "ReportInputDTO",
    "ReportLineDTO",
    "ReportQuantityDTO",
    "ReportSaveDTO",
    "ReportStatusDTO",
    "StoreReportDTO",
    "SummaryDTO",
    "SummaryRowDTO",
    "SummaryStoreDTO",
]
