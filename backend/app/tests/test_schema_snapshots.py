"""Snapshot the SQLite schema (fresh and legacy-migrated) as the contract for a port.

The files in testdata/schema/ hold the exact DDL from sqlite_master plus the recorded
migration ids, so another implementation can create missing tables verbatim and prove
equivalence. Refresh with `SCHEMA_RECORD=1 uv run --locked pytest backend/app/tests/test_schema_snapshots.py`.
"""

import os
import sqlite3
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "pytest-only-secret-key-not-for-production")

import pytest
from sqlalchemy import create_engine, event

from app.db.base import Base
from app.db.migrations import SCHEMA_TABLE, run_migrations
from app.platform.registry import get_registry
from app.tests.test_migrations import PREVIOUS_RELEASE_SCHEMA, VERY_OLD_SCHEMA
from app.core.security import hash_pw

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOTS = ROOT / "testdata" / "schema"
RECORD = os.environ.get("SCHEMA_RECORD") == "1"


def migrate(db_path: Path) -> None:
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")

    @event.listens_for(engine, "connect")
    def _fk(dbapi_connection, _):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    try:
        run_migrations(engine, get_registry(), Base.metadata, backup=lambda _tag: None)
    finally:
        engine.dispose()


def dump(db_path: Path) -> str:
    with closing(sqlite3.connect(db_path)) as db:
        objects = db.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' "
            "ORDER BY type DESC, name"
        ).fetchall()
        ids = [r[0] for r in db.execute(f"SELECT id FROM {SCHEMA_TABLE} ORDER BY id")]
    lines = [f"-- {kind} {name} (table {table})\n{sql};" if sql else f"-- {kind} {name}" for kind, name, table, sql in objects]
    return "\n\n".join(lines) + "\n\n-- migration ids\n" + "\n".join(f"-- {i}" for i in ids) + "\n"


def legacy(tmp_path: Path, script: str) -> Path:
    path = tmp_path / "legacy.db"
    with closing(sqlite3.connect(path)) as db, db:
        db.executescript(script.format(admin_hash=hash_pw("x"), store_hash=hash_pw("x")) if "{admin_hash}" in script else script)
    return path


CASES = {
    "fresh": lambda tmp: tmp / "fresh.db",
    "migrated_very_old": lambda tmp: legacy(tmp, VERY_OLD_SCHEMA),
    "migrated_previous_release": lambda tmp: legacy(tmp, PREVIOUS_RELEASE_SCHEMA),
}


@pytest.mark.parametrize("name", CASES)
def test_schema_snapshot(name, tmp_path):
    path = CASES[name](tmp_path)
    migrate(path)
    actual = dump(path)
    target = SNAPSHOTS / f"{name}.sql"
    if RECORD:
        target.write_text(actual, encoding="utf-8")
    assert actual == target.read_text(encoding="utf-8")
