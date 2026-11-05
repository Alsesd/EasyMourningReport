"""Product catalogue with price history, monthly reports, and per-organisation report settings."""

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel

from app.platform.accounts.models import Organisation


class Product(SQLModel, table=True):
    __tablename__ = "products"

    id: int | None = Field(default=None, primary_key=True)
    name: str
    # Cache of the latest price; historical values live in ProductPrice.
    price_cents: int
    active: bool = Field(default=True)
    # Archive rather than delete so saved report lines remain available.
    archived: bool = Field(default=False)


class ProductPrice(SQLModel, table=True):
    """Price in force from period YYYY-MM until the next history row."""

    __tablename__ = "product_prices"
    __table_args__ = (UniqueConstraint("product_id", "period"),)

    id: int | None = Field(default=None, primary_key=True)
    product_id: int = Field(foreign_key="products.id", index=True)
    period: str = Field(index=True)
    price_cents: int


class ReportSettings(SQLModel, table=True):
    """Reports-only options of one organisation (store)."""

    __tablename__ = "report_settings"

    organisation_id: int = Field(foreign_key="organisations.id", primary_key=True, ondelete="CASCADE")
    # Calculation quantities ("По розрахунку") are recorded and shown separately when enabled.
    calculation_enabled: bool = Field(default=False, sa_column_kwargs={"server_default": "0"})


class Report(SQLModel, table=True):
    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("store_id", "period"),)

    id: int | None = Field(default=None, primary_key=True)
    # The organisation (store) that files the report. The column keeps its historic name.
    store_id: int = Field(foreign_key="organisations.id", index=True)
    period: str = Field(index=True)  # "YYYY-MM"
    status: str = Field(default="draft", index=True)  # "draft" | "submitted"

    store: Organisation = Relationship()
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
