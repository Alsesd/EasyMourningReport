"""Tests for stable public imports and lazy facade behavior."""

import unittest

import app.core as core
import app.db as db_facade
import app.services as services_facade


class PublicFacadeTests(unittest.TestCase):
    def test_database_facade_resolves_modules_and_symbols(self):
        self.assertTrue(hasattr(db_facade.__getattr__("backup"), "backup_db"))
        self.assertTrue(hasattr(db_facade.__getattr__("bootstrap"), "migrate"))
        self.assertTrue(hasattr(db_facade.__getattr__("repositories"), "build_summary"))
        self.assertEqual(db_facade.__getattr__("Product").__name__, "Product")
        self.assertTrue(callable(db_facade.__getattr__("get_db")))
        with self.assertRaises(AttributeError):
            db_facade.__getattr__("not_a_public_export")
        self.assertIn("Product", db_facade.__dir__())

    def test_service_facade_resolves_modules_and_symbols(self):
        self.assertTrue(hasattr(services_facade.__getattr__("excel"), "parse_products_excel"))
        self.assertTrue(hasattr(services_facade.__getattr__("pricing"), "offered_prices"))
        self.assertTrue(callable(services_facade.__getattr__("generate_summary_excel")))
        self.assertTrue(callable(services_facade.__getattr__("offered_prices")))
        with self.assertRaises(AttributeError):
            services_facade.__getattr__("missing_service")
        self.assertIn("parse_products_excel", services_facade.__dir__())

    def test_core_facade_resolves_deferred_dependency_module_and_symbols(self):
        self.assertTrue(hasattr(core.__getattr__("dependencies"), "user_required"))
        self.assertTrue(callable(core.__getattr__("admin_required")))
        self.assertTrue(callable(core.__getattr__("get_db")))
        with self.assertRaises(AttributeError):
            core.__getattr__("unlisted_core_name")
        self.assertIn("dependencies", core.__all__)


if __name__ == "__main__":
    unittest.main()
