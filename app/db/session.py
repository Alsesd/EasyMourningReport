"""Database connection, engine, session factory, and dependency."""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.paths import data_dir

# Database, secret.key and backups/ live in BASE_DIR. For the compiled exe that is the folder
# next to the exe (see paths.py), not the temporary onefile extraction folder.
BASE_DIR = data_dir()
DB_PATH = BASE_DIR / "reports.db"
engine = create_engine(
    f"sqlite:///{DB_PATH.as_posix()}", connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as db:
        yield db
