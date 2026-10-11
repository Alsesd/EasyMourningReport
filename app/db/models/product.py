"""Product and ProductPrice ORM models."""

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    price_cents: Mapped[int]  # the latest price (cache of the newest ProductPrice row)
    active: Mapped[bool] = mapped_column(default=True)  # shown in new report forms
    # Archived = "removed" without losing data: hidden from Settings, saved report lines stay.
    archived: Mapped[bool] = mapped_column(default=False)


class ProductPrice(Base):
    """Price history: `price_cents` is in force from month `period` ("YYYY-MM") until the next record.
    The first record of every product uses period "0000-00". See app/pricing.py."""
    __tablename__ = "product_prices"
    __table_args__ = (UniqueConstraint("product_id", "period"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    period: Mapped[str]
    price_cents: Mapped[int]
