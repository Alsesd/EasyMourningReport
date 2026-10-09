import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import ForeignKey, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

# When packaged with Nuitka (onefile exe), __file__ points into the temporary
# extraction directory which is deleted after the run. Next to the exe the
# database, secret.key and backups/ must persist, so BASE_DIR is the exe folder.
BASE_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "reports.db"
engine = create_engine(f"sqlite:///{DB_PATH.as_posix()}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Store(Base):
    __tablename__ = "stores"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)


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
    price_cents: Mapped[int]
    active: Mapped[bool] = mapped_column(default=True)


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
    unit_price_cents: Mapped[int]  # price snapshot taken when the report is saved
    # Revaluation support: one report may contain several items for the same
    # product with different prices (old price / new price within one month).
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
