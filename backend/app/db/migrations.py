"""Apply each module's migrations once, in registry order, and record them in ``schema_migrations``.

Rules:

* A database (or a module) seen for the first time, with none of the module's tables present,
  is *baselined*: ``create_all`` builds the current schema and the module's migrations are only
  recorded, never run.
* Otherwise pending migrations run in order, each in its own transaction, **before**
  ``create_all``. A migration that needs a new table creates it itself
  (``Model.__table__.create(conn, checkfirst=True)``).
* ``backup_db("before-migrate")`` runs once before the first pending migration.
"""

from collections.abc import Callable, Iterable

from sqlalchemy import Engine, inspect, text

from app.core.modules import Module

SCHEMA_TABLE = "schema_migrations"


def _tables(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _applied(engine: Engine) -> set[str]:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE IF NOT EXISTS {SCHEMA_TABLE} ("
                "id VARCHAR PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
            )
        )
        return {row[0] for row in conn.execute(text(f"SELECT id FROM {SCHEMA_TABLE}"))}


def _record(conn, migration_id: str) -> None:
    conn.execute(text(f"INSERT INTO {SCHEMA_TABLE} (id) VALUES (:id)"), {"id": migration_id})


def module_tables(module: Module) -> set[str]:
    return {m.__tablename__ for m in module.models if hasattr(m, "__tablename__")}  # type: ignore[attr-defined]


def run_migrations(
    engine: Engine,
    modules: Iterable[Module],
    metadata,
    backup: Callable[[str], object] | None = None,
) -> list[str]:
    """Bring the schema up to date. Returns the ids of migrations that actually ran."""
    modules = list(modules)
    existing = _tables(engine)
    applied = _applied(engine)
    ran: list[str] = []
    baseline: list[str] = []
    backed_up = False

    for module in modules:
        ids = [m.id for m in module.migrations]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Duplicate migration ids in module {module.name}")
        fresh = not (module_tables(module) & existing) and not (set(ids) & applied)
        if fresh:
            baseline.extend(i for i in ids if i not in applied)
            continue
        for migration in module.migrations:
            if migration.id in applied:
                continue
            if backup and not backed_up:
                backup("before-migrate")
                backed_up = True
            with engine.begin() as conn:
                migration.apply(conn)
                _record(conn, migration.id)
            ran.append(migration.id)

    metadata.create_all(engine)
    if baseline:
        with engine.begin() as conn:
            for migration_id in baseline:
                _record(conn, migration_id)
    return ran


def columns(conn, table: str) -> list[str]:
    """Column names of a SQLite table (empty when the table does not exist)."""
    return [r[1] for r in conn.exec_driver_sql(f"PRAGMA table_info({table})")]


def table_names(conn) -> set[str]:
    return {
        r[0] for r in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")
    }
