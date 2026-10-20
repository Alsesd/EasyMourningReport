"""Database engine and request-scoped SQLModel sessions.

SQLite remains the default for portable desktop/source deployments. Hosted
deployments may set DATABASE_URL to a SQLAlchemy URL, e.g.
postgresql+pg8000://user:password@host:5432/database.
"""
from collections.abc import Generator
from pathlib import Path
from typing import Any
import os

from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from sqlmodel import Session, create_engine

from app.core.paths import data_dir

BASE_DIR = data_dir()
DB_PATH = BASE_DIR / "reports.db"
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if DATABASE_URL:
    # pg8000 is pure Python and is used for hosted PostgreSQL deployments.
    # Accept provider-default URLs as well as an explicitly selected driver.
    parsed_url = make_url(DATABASE_URL)
    if parsed_url.drivername in {"postgres", "postgresql"}:
        DATABASE_URL = parsed_url.set(drivername="postgresql+pg8000").render_as_string(
            hide_password=False
        )
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        # Workers are short-lived; avoid maintaining a large connection pool.
        pool_size=1,
        max_overflow=0,
    )
else:
    engine = create_engine(
        f"sqlite:///{DB_PATH.as_posix()}",
        connect_args={"check_same_thread": False, "timeout": 30},
        pool_pre_ping=True,
    )

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(
        dbapi_connection: Any, connection_record: Any
    ) -> None:
        """SQLite only enforces declared foreign keys when enabled per connection."""
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()


SessionLocal = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Yield one request-scoped session and always close it afterwards."""
    with SessionLocal() as db:
        yield db
