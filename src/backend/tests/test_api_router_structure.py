"""Smoke tests for the FastAPI composition root and feature router mounting."""

import unittest


class RouterCompositionTests(unittest.TestCase):
    def test_feature_routers_are_mounted(self):
        from app.main import app

        paths = set(app.openapi()["paths"])
        self.assertIn("/admin/summary.xlsx", paths)
        self.assertIn("/admin/backup/download", paths)
        self.assertIn("/api/v1/auth/login", paths)
        self.assertIn("/api/v1/auth/logout", paths)
        self.assertIn("/api/v1/admin/products", paths)
        self.assertIn("/api/v1/admin/stores", paths)
        self.assertIn("/api/v1/admin/reports", paths)
        self.assertIn("/api/v1/admin/logs", paths)
        self.assertIn("/api/v1/admin/tunnel", paths)
        self.assertIn("/manifest.webmanifest", paths)
        self.assertIn("/sw.js", paths)

    def test_legacy_html_routes_are_absent(self):
        from app.main import app

        paths = set(app.openapi()["paths"])
        self.assertNotIn("/login", paths)
        self.assertNotIn("/logout", paths)
        self.assertNotIn("/offline", paths)


if __name__ == "__main__":
    unittest.main()
