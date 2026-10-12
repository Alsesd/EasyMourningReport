"""SQLite engine and request-scoped SQLModel sessions.

SQLite remains the default for the portable Windows distribution, which must
work without a separately installed database server. SQLModel defines the ORM
models; repositories can migrate their query expressions incrementally.
"""

from collections.abc import Generator
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import sessionmaker
from sqlmodel import Session, create_engine

from app.core.paths import data_dir

# Keep persistent data beside the executable (or in per-user data storage when
# the install folder is read-only), never inside a temporary freezer directory.
BASE_DIR = data_dir()
DB_PATH = BASE_DIR / "reports.db"

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


SessionLocal = sessionmaker(
    bind=engine,
    class_=Session,
    expire_on_commit=False,
)


def get_db() -> Generator[Session, None, None]:
    """Yield one request-scoped session and always close it afterwards."""
    with SessionLocal() as db:
        yield db
