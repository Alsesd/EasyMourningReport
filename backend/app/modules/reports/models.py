"""Monthly reports and saved line-item price snapshots."""

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel

from app.db.models.product import Product
from app.db.models.store import Store


class Report(SQLModel, table=True):
    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("store_id", "period"),)

    id: int | None = Field(default=None, primary_key=True)
    store_id: int = Field(foreign_key="stores.id", index=True)
    period: str = Field(index=True)  # "YYYY-MM"
    status: str = Field(default="draft", index=True)  # "draft" | "submitted"

    store: Store = Relationship()
    items: list["ReportItem"] = Relationship(
        back_populates="report",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class ReportItem(SQLModel, table=True):
    __tablename__ = "report_items"

    id: int | None = Field(default=None, primary_key=True)
    report_id: int = Field(foreign_key="reports.id", index=True)
    product_id: int = Field(foreign_key="products.id", index=True)
    quantity: int
    # Independent quantity for "По розрахунку"; it does not affect monetary totals.
    quantity_calc: int = Field(default=0, sa_column_kwargs={"server_default": "0"})
    # Price snapshot means future catalogue changes do not rewrite old reports.
    unit_price_cents: int

    report: Report = Relationship(back_populates="items")
    product: Product = Relationship()
