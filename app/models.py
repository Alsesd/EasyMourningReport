from datetime import datetime

from sqlalchemy import ForeignKey, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .paths import data_dir

# Database, secret.key and backups/ live in BASE_DIR. For the compiled exe that is the folder
# next to the exe (see paths.py), not the temporary onefile extraction folder.
BASE_DIR = data_dir()
DB_PATH = BASE_DIR / "reports.db"
engine = create_engine(f"sqlite:///{DB_PATH.as_posix()}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Store(Base):
    __tablename__ = "stores"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    # Archived = "removed" without losing data: the login stops working, reports stay.
    archived: Mapped[bool] = mapped_column(default=False)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(unique=True)
    password_hash: Mapped[str]
    role: Mapped[str]  # "admin" | "store"
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id"))
    store: Mapped["Store | None"] = relationship()


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


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    login: Mapped[str]
    role: Mapped[str] = mapped_column(default="")
    action: Mapped[str]
    detail: Mapped[str] = mapped_column(default="")
    ip: Mapped[str] = mapped_column(default="")
