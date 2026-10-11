"""Database connection, engine, session factory, and dependency."""

from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.paths import data_dir

# Database, secret.key and backups/ live in BASE_DIR. For the compiled exe that is the folder
# next to the exe (see paths.py), not the temporary onefile extraction folder.
BASE_DIR = data_dir()
DB_PATH = BASE_DIR / "reports.db"
engine = create_engine(
    f"sqlite:///{DB_PATH.as_posix()}",
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _enable_sqlite_foreign_keys(
    dbapi_connection: object, connection_record: object
) -> None:
    """SQLite accepts FK declarations but does not enforce them unless enabled per connection."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Yield one request-scoped session and always close it afterwards."""
    with SessionLocal() as db:
        yield db
