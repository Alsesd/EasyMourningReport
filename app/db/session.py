"""SQLite engine and request-scoped SQLModel sessions.

SQLite remains the default for the portable Windows distribution: the app can
run without a separately installed database server. SQLModel is the ORM/model
layer; repositories can continue to use SQLAlchemy expressions during migration.
"""

from collections.abc import Generator
from typing import Any

from sqlalchemy import event
from sqlmodel import Session, create_engine
from sqlalchemy.orm import sessionmaker

from app.core.paths import data_dir

# Persistent files belong beside the executable (or in the user's data folder
# when the install directory is read-only), never in a freezer's extraction dir.
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
