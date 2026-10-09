from pathlib import Path

from sqlalchemy import ForeignKey, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

DB_PATH = Path(__file__).resolve().parent.parent / "reports.db"  # always next to pyproject.toml
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
    product: Mapped["Product"] = relationship()
