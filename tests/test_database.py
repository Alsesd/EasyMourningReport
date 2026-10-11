"""Regression tests for the application's SQLite configuration."""

import unittest

from sqlalchemy import text

from app.db import Product, get_db
from app.db.session import engine
from app.main import app


class DatabaseConfigurationTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        # The application engine is global in production; tests must release its pooled
        # DBAPI connections at process end to avoid sqlite3 ResourceWarnings.
        engine.dispose()
        super().tearDownClass()

    def test_sqlite_foreign_keys_are_enabled(self):
        """Foreign-key declarations must be enforced on every pooled connection."""
        with engine.connect() as connection:
            self.assertEqual(connection.scalar(text("PRAGMA foreign_keys")), 1)

    def test_database_facade_exports_stable_symbols(self):
        """Callers can keep using the public facade instead of internal module paths."""
        self.assertEqual(Product.__name__, "Product")
        self.assertTrue(callable(get_db))

    def test_admin_backup_route_is_registered(self):
        """Importing the app must register backup routes without Pydantic annotation errors."""
        paths = {route.path for route in app.routes}
        self.assertIn("/admin/backup/download", paths)


if __name__ == "__main__":
    unittest.main()
