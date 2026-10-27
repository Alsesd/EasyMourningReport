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
        self.assertIn("/offline", paths)

    def test_public_auth_router_serves_html_forms(self):
        from app.features.auth.router import public_router, router

        public_paths = {route.path for route in public_router.routes}
        self.assertEqual(public_paths, {"/login", "/logout"})
        api_paths = {route.path for route in router.routes}
        self.assertIn("/auth/login", api_paths)
        self.assertIn("/auth/logout", api_paths)


if __name__ == "__main__":
    unittest.main()
