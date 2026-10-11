"""Product catalogue and period-based price history."""

from sqlmodel import Field, SQLModel
from sqlalchemy import UniqueConstraint


class Product(SQLModel, table=True):
    __tablename__ = "products"

    id: int | None = Field(default=None, primary_key=True)
    name: str
    # Current/latest price cache; authoritative historical values live in ProductPrice.
    price_cents: int
    active: bool = Field(default=True)
    archived: bool = Field(default=False)


class ProductPrice(SQLModel, table=True):
    """Price in force from period YYYY-MM until the next price-history row."""

    __tablename__ = "product_prices"
    __table_args__ = (UniqueConstraint("product_id", "period"),)

    id: int | None = Field(default=None, primary_key=True)
    product_id: int = Field(foreign_key="products.id", index=True)
    period: str = Field(index=True)
    price_cents: int
