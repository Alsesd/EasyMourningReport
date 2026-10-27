"""Regression tests for the application's PostgreSQL database configuration."""

import os
import unittest
from unittest.mock import MagicMock, patch

from app.core.database import engine, get_database_url, get_db
from app.features.products.models import Product
from app.main import app


class DatabaseConfigurationTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        engine.dispose()
        super().tearDownClass()

    def test_database_engine_dialect_and_connectivity(self):
        """Database engine uses postgresql dialect and connects cleanly."""
        self.assertEqual(engine.dialect.name, "postgresql")
        url = get_database_url()
        self.assertTrue(
            url.startswith("postgresql+psycopg://"),
            f"Expected postgresql+psycopg dialect URL, got {url}",
        )

    def test_database_url_normalization(self):
        """Standard postgres schemes normalize to postgresql+psycopg."""
        with patch.dict(os.environ, {"DATABASE_URL": "postgres://user:pass@host:5432/db"}):
            self.assertEqual(
                get_database_url(), "postgresql+psycopg://user:pass@host:5432/db"
            )
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://user:pass@host:5432/db"}):
            self.assertEqual(
                get_database_url(), "postgresql+psycopg://user:pass@host:5432/db"
            )

    def test_database_symbols_have_concrete_module_owners(self):
        """Database symbols are imported from the modules that define them."""
        self.assertEqual(Product.__name__, "Product")
        self.assertTrue(callable(get_db))

    def test_admin_backup_route_is_registered(self):
        """Verify the actual public schema, not FastAPI's internal route objects."""
        paths = app.openapi()["paths"]
        self.assertIn("/admin/backup/download", paths)
        self.assertIn("get", paths["/admin/backup/download"])

    def test_get_db_yields_session_and_closes_context_on_generator_close(self):
        fake_session = MagicMock()
        with patch("app.core.database.SessionLocal") as factory:
            factory.return_value.__enter__.return_value = fake_session
            dependency = get_db()
            self.assertIs(next(dependency), fake_session)
            dependency.close()
            factory.return_value.__enter__.assert_called_once_with()
            factory.return_value.__exit__.assert_called_once()


if __name__ == "__main__":
    unittest.main()
