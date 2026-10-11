"""Tests for database bootstrap behavior on fresh and pre-seeded databases."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "unit-test-only-secret-key")

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import check_pw
from app.db.base import Base
from app.db import bootstrap
from app.db.models.product import Product, ProductPrice
from app.db.models.store import Store
from app.db.models.user import User
from app.services.pricing import BASE_PERIOD


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)
        self.engine_patch = patch.object(bootstrap, "engine", self.engine)
        self.session_patch = patch.object(bootstrap, "SessionLocal", self.Session)
        self.engine_patch.start()
        self.session_patch.start()

    def tearDown(self):
        self.session_patch.stop()
        self.engine_patch.stop()
        self.engine.dispose()

    def test_seed_creates_admin_using_environment_password(self):
        with patch.dict(os.environ, {"ADMIN_PASSWORD": "unit-test-password", "DEMO": ""}), patch("builtins.print") as output:
            bootstrap.seed()
            output.assert_called_once()
        with self.Session() as db:
            admin = db.scalar(select(User).where(User.login == "admin"))
            self.assertIsNotNone(admin)
            self.assertTrue(check_pw("unit-test-password", admin.password_hash))
            self.assertEqual(db.scalar(select(Product.id)), None)

    def test_seed_returns_without_changes_when_a_user_exists(self):
        with self.Session() as db:
            db.add(User(login="admin", password_hash="existing", role="admin"))
            db.commit()
        with patch("builtins.print") as output:
            bootstrap.seed()
            output.assert_not_called()
        with self.Session() as db:
            self.assertEqual(len(list(db.scalars(select(User)))), 1)

    def test_demo_seed_creates_products_prices_and_store_logins(self):
        with patch.dict(os.environ, {"ADMIN_PASSWORD": "unit-test-password", "DEMO": "1"}), patch("builtins.print"):
            bootstrap.seed()
        with self.Session() as db:
            self.assertEqual(len(list(db.scalars(select(Product)))), 3)
            prices = list(db.scalars(select(ProductPrice)))
            self.assertEqual(len(prices), 3)
            self.assertTrue(all(row.period == BASE_PERIOD for row in prices))
            self.assertEqual(len(list(db.scalars(select(Store))),), 2)
            self.assertEqual(len(list(db.scalars(select(User)))), 3)

    def test_migrate_creates_a_fresh_schema_without_backup(self):
        with patch.object(bootstrap, "backup_db") as backup:
            bootstrap.migrate()
            backup.assert_not_called()
            bootstrap.migrate()
        with self.engine.connect() as connection:
            names = {row[0] for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"users", "stores", "products", "product_prices", "reports", "report_items", "audit_log"}.issubset(names))


if __name__ == "__main__":
    unittest.main()
