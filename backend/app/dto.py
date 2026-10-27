"""Typed API request/response DTOs.

Database models are deliberately not returned directly from HTTP handlers:
DTOs make the public contract explicit and keep ORM-only fields private.
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PricePointDTO(DTO):
    period: str
    price_cents: int


class ProductDTO(DTO):
    id: int
    name: str
    price_cents: int
    active: bool
    archived: bool
    used_count: int = 0
    month_prices_cents: list[int] = Field(default_factory=list)
    price_history: list[PricePointDTO] = Field(default_factory=list)


class ProductCreateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    price: str = Field(min_length=1, max_length=30)


class ProductUpdateDTO(ProductCreateDTO):
    active: bool


class MutationDTO(DTO):
    id: int
    archived: bool = False
    deleted: bool = False
    message: str


class StoreDTO(DTO):
    id: int
    name: str
    login: str
    archived: bool
    reports_count: int = 0
    calculation_enabled: bool = False


class StoreCreateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    login: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=6, max_length=256)


class StoreUpdateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    login: str = Field(min_length=2, max_length=40)
    calculation_enabled: bool | None = None


class PasswordDTO(BaseModel):
    password: str = Field(min_length=6, max_length=256)


class StorePasswordDTO(PasswordDTO):
    pass


class LoginDTO(BaseModel):
    login: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class MessageDTO(DTO):
    message: str


class ImportResultDTO(DTO):
    message: str


class SessionDTO(DTO):
    login: str
    role: Literal["admin", "store"]
    store_id: int | None = None
    store_name: str | None = None
    period: str


class ReportInputDTO(DTO):
    price_cents: int
    quantity: int
    quantity_calc: int = 0
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
    # Optional for backward compatibility with clients that predate this field.
    quantity_calc: int | None = Field(default=None, ge=0)


class ReportSaveDTO(BaseModel):
    action: Literal["draft", "submit"] = "draft"
    # Full snapshot of editable product/price inputs, including zero quantities.
    quantities: list[ReportQuantityDTO] = Field(default_factory=list, max_length=5000)


class ReportStatusDTO(BaseModel):
    status: Literal["draft", "submitted"]


class StoreReportDTO(DTO):
    report_id: int | None = None
    store_name: str
    period: str
    status: Literal["new", "draft", "submitted"]
    read_only: bool
    calculation_enabled: bool = False
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
    calculation_enabled: bool = False
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
    calculation_enabled: bool = False


class SummaryRowDTO(DTO):
    name: str
    note: str
    price_cents: int
    label: str
    cells: list[int]
    calculation_cells: list[int] = Field(default_factory=list)
    quantity: int
    calculation_quantity: int = 0
    sum_cents: int


class SummaryDTO(DTO):
    period: str
    submitted_only: bool
    stores: list[SummaryStoreDTO] = Field(default_factory=list)
    rows: list[SummaryRowDTO] = Field(default_factory=list)
    store_totals_cents: list[int] = Field(default_factory=list)
    grand_total_cents: int


class AuditLogDTO(DTO):
    id: int
    ts: datetime
    login: str
    role: str
    action: str
    detail: str
    ip: str
