#!/usr/bin/env python3
"""Copy data from SQLite to PostgreSQL while preserving table columns and primary keys.

For a complete migration, let the tool create missing tables and copy every table:

    python scripts/sqlite_to_postgres.py --source ./data/reports.db --target "$DATABASE_URL"

For a table-only transfer into an already-created PostgreSQL schema, select the table:

    python scripts/sqlite_to_postgres.py --source ./data/reports.db --target "$DATABASE_URL" --tables reports

A full migration creates table definitions by default. A partial migration expects the
selected destination table(s) to exist; use --create-schema only when dependencies already
exist or the selected table has no foreign-key dependencies. The tool never deletes rows
unless --replace is passed explicitly.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Iterable

from sqlalchemy import MetaData, Table, create_engine, delete, insert, inspect, select, text
from sqlalchemy.engine import Engine, URL
from sqlalchemy.exc import SQLAlchemyError


def sqlite_url(value: str) -> str:
    """Accept either a SQLAlchemy SQLite URL or a filesystem path."""
    if value.startswith("sqlite:"):
        return value
    path = Path(value).expanduser().resolve()
    return URL.create("sqlite", database=str(path)).render_as_string(hide_password=False)


def reflect_source(engine: Engine) -> MetaData:
    metadata = MetaData()
    metadata.reflect(bind=engine)
    return metadata


def validate_target_tables(engine: Engine, tables: Iterable[Table]) -> None:
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    missing = [table.name for table in tables if table.name not in existing]
    if missing:
        names = ", ".join(sorted(missing))
        raise RuntimeError(
            f"Destination table(s) do not exist: {names}. Run a full migration or "
            "create the matching schema before a table-only transfer."
        )
    for table in tables:
        source_columns = [column.name for column in table.columns]
        target_columns = [column["name"] for column in inspector.get_columns(table.name)]
        missing_columns = [name for name in source_columns if name not in target_columns]
        if missing_columns:
            raise RuntimeError(
                f"Destination table {table.name!r} is missing column(s): "
                + ", ".join(missing_columns)
            )


def selected_tables(metadata: MetaData, names: list[str] | None) -> list[Table]:
    if names:
        missing = sorted(set(names) - set(metadata.tables))
        if missing:
            raise ValueError(f"Unknown SQLite table(s): {', '.join(missing)}")
        wanted = set(names)
        return [table for table in metadata.sorted_tables if table.name in wanted]
    return list(metadata.sorted_tables)


def sync_postgres_sequences(connection, tables: Iterable[Table]) -> None:
    """Advance serial/identity sequences past imported explicit primary-key values."""
    if connection.dialect.name != "postgresql":
        return
    preparer = connection.dialect.identifier_preparer
    for table in tables:
        primary_key = list(table.primary_key.columns)
        if len(primary_key) != 1:
            continue
        column = primary_key[0]
        if not (str(column.type).upper().startswith(("INTEGER", "BIGINT", "SMALLINT"))):
            continue
        sequence = connection.execute(
            text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
            {"table_name": table.name, "column_name": column.name},
        ).scalar_one_or_none()
        if not sequence:
            continue
        q_table = preparer.format_table(table)
        q_column = preparer.quote(column.name)
        connection.execute(
            text(
                f"SELECT setval(CAST(:sequence AS regclass), "
                f"COALESCE(MAX({q_column}), 1), MAX({q_column}) IS NOT NULL) "
                f"FROM {q_table}"
            ),
            {"sequence": sequence},
        )


def migrate(
    source: str,
    target: str,
    *,
    table_names: list[str] | None = None,
    replace: bool = False,
    create_schema: bool | None = None,
    batch_size: int = 1000,
) -> dict[str, int]:
    """Copy tables and rows from SQLite to a PostgreSQL-compatible SQLAlchemy URL."""
    source_engine = create_engine(sqlite_url(source))
    target_engine = create_engine(target)
    try:
        if source_engine.dialect.name != "sqlite":
            raise ValueError("The source must be a SQLite database URL or file path.")
        if target_engine.dialect.name != "postgresql":
            raise ValueError("The destination must be a PostgreSQL SQLAlchemy URL.")

        metadata = reflect_source(source_engine)
        tables = selected_tables(metadata, table_names)
        if not tables:
            raise RuntimeError("The SQLite database contains no user tables to copy.")

        # Full migrations create a schema by default. Partial moves intentionally target an
        # existing schema to avoid unexpectedly creating unrelated dependency tables.
        should_create = (not table_names) if create_schema is None else create_schema
        if should_create:
            metadata.create_all(target_engine, tables=tables)
        else:
            validate_target_tables(target_engine, tables)

        counts: dict[str, int] = {}
        with source_engine.connect() as source_connection, target_engine.begin() as target_connection:
            if replace:
                for table in reversed(tables):
                    target_connection.execute(delete(table))
            for table in tables:
                source_result = source_connection.execute(select(table))
                copied = 0
                while True:
                    batch = source_result.fetchmany(batch_size)
                    if not batch:
                        break
                    target_connection.execute(
                        insert(table), [dict(row._mapping) for row in batch]
                    )
                    copied += len(batch)
                counts[table.name] = copied
            sync_postgres_sequences(target_connection, tables)
        return counts
    finally:
        source_engine.dispose()
        target_engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        default=os.getenv("SQLITE_DATABASE_URL") or os.getenv("SQLITE_DATABASE_PATH"),
        help="SQLite URL or path to reports.db (or SQLITE_DATABASE_URL / SQLITE_DATABASE_PATH)",
    )
    parser.add_argument(
        "--target",
        default=os.getenv("DATABASE_URL"),
        help="PostgreSQL SQLAlchemy URL (or DATABASE_URL)",
    )
    parser.add_argument(
        "--tables",
        help="Comma-separated subset of table names; destination schema must already exist",
    )
    parser.add_argument(
        "--create-schema",
        action="store_true",
        help="Create missing selected table definitions in the destination",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete destination rows from selected tables before copying",
    )
    parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args(argv)
    if not args.source:
        parser.error("--source or SQLITE_DATABASE_PATH is required")
    if not args.target:
        parser.error("--target or DATABASE_URL is required")
    if args.batch_size < 1:
        parser.error("--batch-size must be greater than zero")

    try:
        counts = migrate(
            args.source,
            args.target,
            table_names=[name.strip() for name in args.tables.split(",") if name.strip()]
            if args.tables
            else None,
            replace=args.replace,
            create_schema=True if args.create_schema else None,
            batch_size=args.batch_size,
        )
    except (SQLAlchemyError, OSError, RuntimeError, ValueError) as exc:
        print(f"Migration failed: {exc}", file=sys.stderr)
        return 1

    for table, count in counts.items():
        print(f"{table}: copied {count} row(s)")
    print("Migration completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
