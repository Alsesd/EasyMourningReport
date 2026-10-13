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

        # Recent FastAPI versions may keep included routers as internal
        # _IncludedRouter objects in app.routes, which do not expose .path.
        # OpenAPI resolves the complete router tree into the public paths and
        # is the stable interface for verifying the mounted URL structure.
        paths = set(app.openapi()["paths"])
        self.assertIn("/admin", paths)
        self.assertIn("/admin/products/import", paths)
        self.assertIn("/admin/summary.xlsx", paths)
        self.assertIn("/login", paths)
        self.assertIn("/report", paths)
        self.assertIn("/api/v1/session", paths)
        self.assertIn("/api/v1/admin/products", paths)
        self.assertIn("/api/v1/admin/stores", paths)
        self.assertIn("/api/v1/store/reports/{period}", paths)
        self.assertIn("/api/v1/admin/summary", paths)


if __name__ == "__main__":
    unittest.main()
