"""Smoke tests for router composition and endpoint availability."""

import unittest


class RouterCompositionTests(unittest.TestCase):
    def test_server_routes_are_registered(self):
        from app.main import app

        paths = set(app.openapi()["paths"])
        self.assertIn("/api/v1/admin/summary.xlsx", paths)
        self.assertIn("/api/v1/admin/backup/download", paths)
        self.assertIn("/api/v1/users", paths)
        self.assertIn("/api/v1/roles", paths)
        self.assertIn("/api/v1/organisations", paths)
        self.assertIn("/api/v1/transport/status", paths)
        self.assertIn("/api/v1/auth/login", paths)
        self.assertIn("/api/v1/auth/logout", paths)
        self.assertIn("/manifest.webmanifest", paths)
        self.assertIn("/sw.js", paths)
        self.assertIn("/offline", paths)


if __name__ == "__main__":
    unittest.main()
