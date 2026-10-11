"""Report and ReportItem ORM models."""

from typing import TYPE_CHECKING
from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.store import Store
    from app.db.models.product import Product


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("store_id", "period"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"))
    period: Mapped[str]  # "YYYY-MM"
    status: Mapped[str] = mapped_column(default="draft")  # "draft" | "submitted" (= locked)
    store: Mapped["Store"] = relationship()
    items: Mapped[list["ReportItem"]] = relationship(cascade="all, delete-orphan")


class ReportItem(Base):
    __tablename__ = "report_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int]
    unit_price_cents: Mapped[int]  # price this quantity was reported at (old/new price in a change month)
    product: Mapped["Product"] = relationship()
