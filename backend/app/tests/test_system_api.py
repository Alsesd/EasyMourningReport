"""System endpoints (tunnel, Tailscale Funnel) require platform.system.manage and never leak secrets."""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "api-test-session-secret")

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.platform.accounts.testing import make_admin, make_member, make_organisation


class SystemApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)

        def override_get_db():
            with self.Session() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        with self.Session() as db:
            make_admin(db, "apiadmin", "admin123")
            make_member(db, make_organisation(db, "Shop"), "apistore", "store123")
            db.commit()
        self.admin_client = TestClient(app, follow_redirects=False)
        self.store_client = TestClient(app, follow_redirects=False)
        for client, login, password in (
            (self.admin_client, "apiadmin", "admin123"),
            (self.store_client, "apistore", "store123"),
        ):
            response = client.post(
                "/api/v1/auth/login", json={"login": login, "password": password},
                headers={"origin": "http://testserver"},
            )
            self.assertEqual(response.status_code, 200)

    def tearDown(self):
        self.admin_client.close()
        self.store_client.close()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_tailscale_funnel_controls_are_admin_only_and_do_not_return_secrets(self):
        status = {
            "enabled": False,
            "state": "disabled",
            "public_url": "",
            "login_url": "",
            "error": "",
        }
        with patch("app.platform.system.routes.tailscale_status", return_value=status):
            response = self.admin_client.get("/api/v1/admin/tailscale")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "disabled")

        refused = self.admin_client.post(
            "/api/v1/admin/tailscale",
            json={"confirm_public": False},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(refused.status_code, 400)

        running = {**status, "enabled": True, "state": "authentication-required",
                   "login_url": "https://login.tailscale.com/example"}
        with patch("app.platform.system.routes.start_funnel", return_value=running) as start:
            response = self.admin_client.post(
                "/api/v1/admin/tailscale",
                json={"confirm_public": True, "auth_key": "tskey-test-secret"},
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "authentication-required")
        start.assert_called_once_with("tskey-test-secret", autostart=True)
        self.assertNotIn("auth_key", response.json())

        with patch("app.platform.system.routes.stop_funnel", return_value=status):
            response = self.admin_client.delete(
                "/api/v1/admin/tailscale",
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["enabled"])

        forbidden = self.store_client.get("/api/v1/admin/tailscale")
        self.assertEqual(forbidden.status_code, 403)

    def test_tailscale_autostart_toggle_is_admin_only_and_does_not_disconnect(self):
        enabled = {"enabled": True, "autostart": True, "state": "running",
                   "public_url": "https://example.ts.net", "login_url": "", "error": ""}
        with patch("app.platform.system.routes.set_tailscale_autostart", return_value=enabled) as setter:
            response = self.admin_client.put(
                "/api/v1/admin/tailscale/autostart",
                json={"enabled": True},
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["autostart"])
        setter.assert_called_once_with(True)

        disabled = {**enabled, "autostart": False}
        with patch("app.platform.system.routes.set_tailscale_autostart", return_value=disabled) as setter:
            response = self.admin_client.put(
                "/api/v1/admin/tailscale/autostart",
                json={"enabled": False},
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["autostart"])
        self.assertEqual(response.json()["state"], "running")
        setter.assert_called_once_with(False)

        invalid = self.admin_client.put(
            "/api/v1/admin/tailscale/autostart",
            json={"enabled": "yes"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(invalid.status_code, 422)
        forbidden = self.store_client.put(
            "/api/v1/admin/tailscale/autostart",
            json={"enabled": True},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(forbidden.status_code, 403)

    def test_tunnel_controls_and_autostart_are_admin_only(self):
        status = {
            "enabled": False,
            "state": "disabled",
            "public_url": "",
            "login_url": "",
            "error": "",
        }
        with patch("app.platform.system.routes.tunnel_status", return_value=status):
            response = self.admin_client.get("/api/v1/admin/tunnel")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "disabled")

        refused = self.admin_client.post(
            "/api/v1/admin/tunnel",
            json={"confirm_public": False},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(refused.status_code, 400)

        running = {**status, "enabled": True, "state": "running", "public_url": "https://test.trycloudflare.com"}
        with patch("app.platform.system.routes.start_tunnel", return_value=running) as start:
            response = self.admin_client.post(
                "/api/v1/admin/tunnel",
                json={"confirm_public": True, "auth_key": "tok-123"},
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["public_url"], "https://test.trycloudflare.com")
        start.assert_called_once_with("tok-123", autostart=True)

        with patch("app.platform.system.routes.set_tunnel_autostart", return_value=running) as setter:
            response = self.admin_client.put(
                "/api/v1/admin/tunnel/autostart",
                json={"enabled": True},
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        setter.assert_called_once_with(True)

        with patch("app.platform.system.routes.stop_tunnel", return_value=status):
            response = self.admin_client.delete(
                "/api/v1/admin/tunnel",
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["enabled"])

        forbidden = self.store_client.get("/api/v1/admin/tunnel")
        self.assertEqual(forbidden.status_code, 403)


if __name__ == "__main__":
    unittest.main()
