"""Smoke tests for the public ASGI facade and router composition."""

import unittest


class RouterCompositionTests(unittest.TestCase):
    def test_facade_exports_application(self):
        from app.api import admin_router, app, public_router

        self.assertIsNotNone(app)
        self.assertGreater(len(public_router.routes), 0)
        self.assertGreater(len(admin_router.routes), 0)

    def test_admin_routes_are_nested_under_admin_prefix(self):
        from app.api import app

        paths = {route.path for route in app.routes}
        self.assertIn("/admin", paths)
        self.assertIn("/admin/products/import", paths)
        self.assertIn("/admin/summary.xlsx", paths)
        self.assertIn("/login", paths)
        self.assertIn("/report", paths)


if __name__ == "__main__":
    unittest.main()
