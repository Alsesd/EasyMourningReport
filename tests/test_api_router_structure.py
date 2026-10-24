"""Smoke tests for the public ASGI facade and router composition."""

import unittest


class RouterCompositionTests(unittest.TestCase):
    def test_facade_exports_application(self):
        from app.api import admin_router, app, public_router

        self.assertIsNotNone(app)
        self.assertGreater(len(public_router.routes), 0)
        self.assertGreater(len(admin_router.routes), 0)

    def test_server_routes_are_nested_correctly(self):
        from app.api import app

        paths = set(app.openapi()["paths"])
        self.assertIn("/admin/summary.xlsx", paths)
        self.assertIn("/admin/backup/download", paths)
        self.assertIn("/api/v1/auth/login", paths)
        self.assertIn("/api/v1/auth/logout", paths)
        self.assertIn("/manifest.webmanifest", paths)
        self.assertIn("/sw.js", paths)
        self.assertIn("/offline", paths)


if __name__ == "__main__":
    unittest.main()
