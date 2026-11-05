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

    def test_pwa_files_and_health_probe_are_served(self):
        from fastapi.testclient import TestClient

        from app.main import app

        client = TestClient(app)
        for path, content_type in (
            ("/healthz", "application/json"),
            ("/manifest.webmanifest", "application/manifest+json"),
            ("/sw.js", "application/javascript"),
            ("/offline", "text/html"),
        ):
            response = client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertIn(content_type, response.headers["content-type"])


if __name__ == "__main__":
    unittest.main()
