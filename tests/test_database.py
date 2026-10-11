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
        """Verify the actual public schema, not FastAPI's internal route objects."""
        paths = app.openapi()["paths"]
        self.assertIn("/admin/backup/download", paths)
        self.assertIn("get", paths["/admin/backup/download"])

    def test_get_db_yields_session_and_closes_context_on_generator_close(self):
        from unittest.mock import MagicMock, patch
        from app.db.session import get_db

        fake_session = MagicMock()
        with patch("app.db.session.SessionLocal") as factory:
            factory.return_value.__enter__.return_value = fake_session
            dependency = get_db()
            self.assertIs(next(dependency), fake_session)
            dependency.close()
            factory.return_value.__enter__.assert_called_once_with()
            factory.return_value.__exit__.assert_called_once()


if __name__ == "__main__":
    unittest.main()
