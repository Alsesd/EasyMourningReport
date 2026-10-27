import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

os.environ["SECRET_KEY"] = "unit-test-only-secret-key"

from sqlalchemy import create_engine

from app.db import bootstrap
from app.services.pricing import BASE_PERIOD


class MigrationTests(unittest.TestCase):
    def test_legacy_database_is_upgraded_and_migration_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "legacy.db"
            with closing(sqlite3.connect(db_path)) as db:
                with db:
                    db.executescript(
                        """
                        CREATE TABLE stores (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL UNIQUE);
                        CREATE TABLE users (
                            id INTEGER PRIMARY KEY, login VARCHAR NOT NULL UNIQUE,
                            password_hash VARCHAR NOT NULL, role VARCHAR NOT NULL, store_id INTEGER
                        );
                        CREATE TABLE products (
                            id INTEGER PRIMARY KEY, name VARCHAR NOT NULL,
                            price_cents INTEGER NOT NULL, active BOOLEAN NOT NULL DEFAULT 1
                        );
                        CREATE TABLE reports (
                            id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL, period VARCHAR NOT NULL
                        );
                        INSERT INTO stores(id, name) VALUES (1, 'Shop');
                        INSERT INTO users(id, login, password_hash, role, store_id)
                            VALUES (1, ' Admin ', 'placeholder-hash', 'admin', NULL);
                        INSERT INTO products(id, name, price_cents, active)
                            VALUES (1, 'Apples', 125, 1);
                        INSERT INTO reports(id, store_id, period) VALUES (1, 1, '2026-09');
                        """
                    )

            engine = create_engine(f"sqlite:///{db_path.as_posix()}")
            try:
                with patch.object(bootstrap, "engine", engine), patch.object(bootstrap, "backup_db") as backup_mock:
                    bootstrap.migrate()
                    backup_mock.assert_called_once_with("before-migrate")
                    bootstrap.migrate()
                    backup_mock.assert_called_once_with("before-migrate")

                with closing(sqlite3.connect(db_path)) as db:
                    for table, expected in (
                        ("products", "archived"),
                        ("stores", "archived"),
                        ("reports", "status"),
                    ):
                        columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
                        self.assertIn(expected, columns)
                    self.assertEqual(
                        db.execute("SELECT product_id, period, price_cents FROM product_prices").fetchall(),
                        [(1, BASE_PERIOD, 125)],
                    )
                    self.assertEqual(db.execute("SELECT login FROM users WHERE id = 1").fetchone(), ("admin",))
                    self.assertEqual(db.execute("SELECT status FROM reports WHERE id = 1").fetchone(), ("draft",))
            finally:
                engine.dispose()


if __name__ == "__main__":
    unittest.main()
