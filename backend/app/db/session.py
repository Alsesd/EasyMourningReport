"""SQLite engine and request-scoped SQLModel sessions.

SQLite runs inside the application process: there is no database server to install,
start or keep alive (see docs/adr/0003-keep-sqlite.md). Every connection gets:

* ``foreign_keys=ON``  - SQLite only enforces declared foreign keys when asked;
* ``synchronous=FULL`` - a committed transaction survives a power cut;
* the journal mode chosen by :func:`journal_mode` - WAL (readers never block the writer)
  on local disks, the classic rollback journal on shared folders where WAL is unsafe.
"""

import os
import sys
from collections.abc import Generator
from pathlib import Path
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
    # timeout = how long a writer waits for the write lock before "database is locked".
    connect_args={"check_same_thread": False, "timeout": 30},
    # One connection per request thread (Starlette's thread pool runs up to 40 sync handlers),
    # so a burst of requests never waits for a pooled connection.
    pool_size=10,
    max_overflow=30,
    pool_pre_ping=True,
)


# Filesystems where SQLite's WAL shared-memory file is unreliable (network shares and the
# host-folder sharing used by Docker Desktop / WSL). The rollback journal is safe on them.
SHARED_FILESYSTEMS = {
    "9p", "cifs", "smb3", "smbfs", "nfs", "nfs4", "drvfs", "virtiofs",
    "fakeowner", "fuse.grpcfuse", "fuse.sshfs", "fuse.osxfs", "vboxsf",
}


def filesystem_type(path: Path, mounts_file: Path = Path("/proc/mounts")) -> str:
    """Filesystem type of the mount holding ``path`` (Linux only; "" when unknown)."""
    try:
        target = str(path.resolve())
        best, fstype = "", ""
        for line in mounts_file.read_text(encoding="utf-8", errors="replace").splitlines():
            parts = line.split()
            if len(parts) < 3:
                continue
            mount_point = parts[1].replace("\\040", " ")
            inside = target == mount_point or target.startswith(mount_point.rstrip("/") + "/")
            if inside and len(mount_point) >= len(best):
                best, fstype = mount_point, parts[2]
        return fstype
    except OSError:
        return ""


def journal_mode(folder: Path = DB_PATH.parent) -> str:
    """``SQLITE_JOURNAL_MODE`` = wal | delete | auto (default: WAL unless the folder is a shared mount)."""
    wanted = os.getenv("SQLITE_JOURNAL_MODE", "auto").strip().lower()
    if wanted in {"wal", "delete"}:
        return wanted
    if sys.platform.startswith("linux") and filesystem_type(folder) in SHARED_FILESYSTEMS:
        return "delete"
    return "wal"


JOURNAL_MODE = journal_mode()


@event.listens_for(engine, "connect")
def _configure_sqlite_connection(
    dbapi_connection: Any, connection_record: Any
) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute(f"PRAGMA journal_mode={JOURNAL_MODE}")
        cursor.execute("PRAGMA synchronous=FULL")
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


def checkpoint() -> None:
    """Fold the WAL file back into the database (clean single-file state on shutdown)."""
    if JOURNAL_MODE == "wal":
        with engine.connect() as conn:
            conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
