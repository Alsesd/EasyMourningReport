import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ["SECRET_KEY"] = "unit-test-only-secret-key"

from sqlalchemy import create_engine, inspect, text

from app.core import bootstrap
from app.features.products.service import BASE_PERIOD


class MigrationTests(unittest.TestCase):
    def test_legacy_database_is_upgraded_and_migration_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "legacy.db"
            engine = create_engine(f"sqlite:///{db_path.as_posix()}")

            with engine.begin() as conn:
                conn.execute(
                    text(
                        "CREATE TABLE stores (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL UNIQUE);"
                    )
                )
                conn.execute(
                    text(
                        "CREATE TABLE users ("
                        "id INTEGER PRIMARY KEY, login VARCHAR NOT NULL UNIQUE, "
                        "password_hash VARCHAR NOT NULL, role VARCHAR NOT NULL, store_id INTEGER"
                        ");"
                    )
                )
                conn.execute(
                    text(
                        "CREATE TABLE products ("
                        "id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, "
                        "price_cents INTEGER NOT NULL, active BOOLEAN NOT NULL DEFAULT 1"
                        ");"
                    )
                )
                conn.execute(
                    text(
                        "CREATE TABLE reports ("
                        "id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL, period VARCHAR NOT NULL"
                        ");"
                    )
                )
                conn.execute(text("INSERT INTO stores(id, name) VALUES (1, 'Shop');"))
                conn.execute(
                    text(
                        "INSERT INTO users(id, login, password_hash, role, store_id) "
                        "VALUES (1, ' Admin ', 'placeholder-hash', 'admin', NULL);"
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO products(id, name, price_cents, active) "
                        "VALUES (1, 'Apples', 125, 1);"
                    )
                )
                conn.execute(text("INSERT INTO reports(id, store_id, period) VALUES (1, 1, '2026-09');"))

            try:
                with patch.object(bootstrap, "engine", engine), patch.object(bootstrap, "backup_db") as backup_mock:
                    bootstrap.migrate()
                    backup_mock.assert_called_once_with("before-migrate")
                    bootstrap.migrate()
                    backup_mock.assert_called_once_with("before-migrate")

                inspector = inspect(engine)
                for table, expected in (
                    ("products", "archived"),
                    ("stores", "archived"),
                    ("reports", "status"),
                ):
                    cols = {col["name"] for col in inspector.get_columns(table)}
                    self.assertIn(expected, cols)

                with engine.connect() as conn:
                    prices = conn.execute(
                        text("SELECT product_id, period, price_cents FROM product_prices")
                    ).fetchall()
                    self.assertEqual(prices, [(1, BASE_PERIOD, 125)])

                    login = conn.execute(text("SELECT login FROM users WHERE id = 1")).fetchone()
                    self.assertEqual(login, ("admin",))

                    status = conn.execute(text("SELECT status FROM reports WHERE id = 1")).fetchone()
                    self.assertEqual(status, ("draft",))
            finally:
                engine.dispose()


if __name__ == "__main__":
    unittest.main()
