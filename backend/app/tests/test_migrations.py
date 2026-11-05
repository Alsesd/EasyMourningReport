import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

os.environ["SECRET_KEY"] = "unit-test-only-secret-key"

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlmodel import select

from app.core.security import hash_pw
from app.platform import bootstrap
from app.modules.reports.pricing import BASE_PERIOD
from app.platform.accounts.access import effective_permissions
from app.platform.accounts.models import User

VERY_OLD_SCHEMA = """
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
CREATE TABLE report_items (
    id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL
);
INSERT INTO stores(id, name) VALUES (1, 'Shop');
INSERT INTO users(id, login, password_hash, role, store_id)
    VALUES (1, ' Admin ', 'placeholder-hash', 'admin', NULL);
INSERT INTO users(id, login, password_hash, role, store_id)
    VALUES (2, 'Shop1', 'placeholder-hash', 'store', 1);
INSERT INTO products(id, name, price_cents, active) VALUES (1, 'Apples', 125, 1);
INSERT INTO reports(id, store_id, period) VALUES (1, 1, '2026-09');
INSERT INTO report_items(id, report_id, product_id, quantity, unit_price_cents)
    VALUES (1, 1, 1, 4, 125);
"""

# The schema the previous release created with SQLModel (single role column, one login per store).
PREVIOUS_RELEASE_SCHEMA = """
CREATE TABLE stores (
    id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, archived BOOLEAN NOT NULL,
    calculation_enabled BOOLEAN DEFAULT '0' NOT NULL
);
CREATE UNIQUE INDEX ix_stores_name ON stores (name);
CREATE INDEX ix_stores_archived ON stores (archived);
CREATE TABLE users (
    id INTEGER NOT NULL PRIMARY KEY, login VARCHAR NOT NULL, password_hash VARCHAR NOT NULL,
    role VARCHAR NOT NULL, store_id INTEGER, FOREIGN KEY(store_id) REFERENCES stores (id)
);
CREATE UNIQUE INDEX ix_users_login ON users (login);
CREATE INDEX ix_users_role ON users (role);
CREATE INDEX ix_users_store_id ON users (store_id);
CREATE TABLE products (
    id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, price_cents INTEGER NOT NULL,
    active BOOLEAN NOT NULL, archived BOOLEAN NOT NULL
);
CREATE TABLE product_prices (
    id INTEGER NOT NULL PRIMARY KEY, product_id INTEGER NOT NULL, period VARCHAR NOT NULL,
    price_cents INTEGER NOT NULL, UNIQUE (product_id, period), FOREIGN KEY(product_id) REFERENCES products (id)
);
CREATE TABLE reports (
    id INTEGER NOT NULL PRIMARY KEY, store_id INTEGER NOT NULL, period VARCHAR NOT NULL,
    status VARCHAR NOT NULL, UNIQUE (store_id, period), FOREIGN KEY(store_id) REFERENCES stores (id)
);
CREATE TABLE report_items (
    id INTEGER NOT NULL PRIMARY KEY, report_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL, quantity_calc INTEGER DEFAULT '0' NOT NULL, unit_price_cents INTEGER NOT NULL,
    FOREIGN KEY(report_id) REFERENCES reports (id), FOREIGN KEY(product_id) REFERENCES products (id)
);
CREATE TABLE audit_log (
    id INTEGER NOT NULL PRIMARY KEY, ts DATETIME NOT NULL, login VARCHAR NOT NULL, role VARCHAR NOT NULL,
    action VARCHAR NOT NULL, detail VARCHAR NOT NULL, ip VARCHAR NOT NULL
);
INSERT INTO stores VALUES (1, 'Calc shop', 0, 1), (2, 'Plain shop', 0, 0), (3, 'Closed shop', 1, 0);
INSERT INTO users VALUES (1, 'admin', '{admin_hash}', 'admin', NULL);
INSERT INTO users VALUES (2, 'calc', '{store_hash}', 'store', 1);
INSERT INTO users VALUES (3, 'plain', '{store_hash}', 'store', 2);
INSERT INTO users VALUES (4, 'closed', '{store_hash}', 'store', 3);
INSERT INTO products VALUES (1, 'Bread', 150, 1, 0);
INSERT INTO product_prices VALUES (1, 1, '0000-00', 150);
INSERT INTO reports VALUES (1, 1, '2026-10', 'submitted');
INSERT INTO report_items VALUES (1, 1, 1, 2, 5, 150);
"""


class MigrationTests(unittest.TestCase):
    def _migrate(self, db_path: Path, times: int = 2):
        engine = create_engine(f"sqlite:///{db_path.as_posix()}")

        @event.listens_for(engine, "connect")
        def _fk(dbapi_connection, _):
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

        try:
            with patch.object(bootstrap, "engine", engine), patch.object(bootstrap, "backup_db") as backup_mock:
                first = bootstrap.migrate()
                for _ in range(times - 1):
                    self.assertEqual(bootstrap.migrate(), [])
                backup_mock.assert_called_once_with("before-migrate")
            with sessionmaker(engine, expire_on_commit=False)() as db:
                users = {u.login: (u.organisation_id, u.active, sorted(effective_permissions(u)))
                         for u in db.scalars(select(User))}
        finally:
            engine.dispose()
        return first, users

    def test_very_old_database_is_upgraded_and_migration_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "legacy.db"
            with closing(sqlite3.connect(db_path)) as db, db:
                db.executescript(VERY_OLD_SCHEMA)

            ran, users = self._migrate(db_path)
            self.assertEqual(
                ran,
                ["platform.0001_organisations_and_roles", "reports.0001_legacy_columns", "reports.0002_settings_table"],
            )
            self.assertEqual(users["admin"][0], None)
            self.assertIn("platform.roles.manage", users["admin"][2])
            self.assertEqual(users["shop1"], (1, True, ["reports.submit"]))

            with closing(sqlite3.connect(db_path)) as db:
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertIn("organisations", tables)
                self.assertNotIn("stores", tables)
                for table, expected in (
                    ("products", "archived"),
                    ("organisations", "archived"),
                    ("reports", "status"),
                    ("report_items", "quantity_calc"),
                    ("users", "organisation_id"),
                ):
                    self.assertIn(expected, {row[1] for row in db.execute(f"PRAGMA table_info({table})")})
                self.assertNotIn("role", {row[1] for row in db.execute("PRAGMA table_info(users)")})
                self.assertEqual(
                    db.execute("SELECT product_id, period, price_cents FROM product_prices").fetchall(),
                    [(1, BASE_PERIOD, 125)],
                )
                self.assertEqual(db.execute("SELECT status FROM reports WHERE id = 1").fetchone(), ("draft",))
                self.assertEqual(db.execute("SELECT quantity_calc FROM report_items WHERE id = 1").fetchone(), (0,))

    def test_previous_release_keeps_logins_reports_and_calculation_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "reports.db"
            script = PREVIOUS_RELEASE_SCHEMA.format(admin_hash=hash_pw("admin-pass"), store_hash=hash_pw("store-pass"))
            with closing(sqlite3.connect(db_path)) as db, db:
                db.executescript(script)

            _, users = self._migrate(db_path)
            self.assertEqual(users["calc"], (1, True, ["reports.submit"]))
            self.assertEqual(users["plain"], (2, True, ["reports.submit"]))
            self.assertEqual(users["closed"][0], 3)

            with closing(sqlite3.connect(db_path)) as db:
                self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
                self.assertEqual(
                    db.execute("SELECT organisation_id, calculation_enabled FROM report_settings").fetchall(),
                    [(1, 1)],
                )
                self.assertNotIn("calculation_enabled", {r[1] for r in db.execute("PRAGMA table_info(organisations)")})
                self.assertEqual(
                    db.execute("SELECT id, name, archived FROM organisations ORDER BY id").fetchall(),
                    [(1, "Calc shop", 0), (2, "Plain shop", 0), (3, "Closed shop", 1)],
                )
                self.assertEqual(db.execute("SELECT store_id, status FROM reports").fetchall(), [(1, "submitted")])
                reports_fk = db.execute("PRAGMA foreign_key_list(reports)").fetchall()
                self.assertIn("organisations", {row[2] for row in reports_fk})


if __name__ == "__main__":
    unittest.main()
