"""System endpoints (tunnel, backups, health) require platform.system.manage and never leak secrets."""

import os
import tempfile
import unittest
from pathlib import Path
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

    def test_tunnel_controls_and_autostart_are_admin_only(self):
        status = {
            "enabled": False,
            "autostart": False,
            "has_token": False,
            "state": "disabled",
            "public_url": "",
            "error": "",
        }
        with patch("app.platform.system.routes.tunnel.status", return_value=status):
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
        with patch("app.platform.system.routes.tunnel.start", return_value=running) as start:
            response = self.admin_client.post(
                "/api/v1/admin/tunnel",
                json={"confirm_public": True, "token": "tok-123"},
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["public_url"], "https://test.trycloudflare.com")
        start.assert_called_once_with("tok-123", autostart=True)

        with patch("app.platform.system.routes.tunnel.set_autostart", return_value=running) as setter:
            response = self.admin_client.put(
                "/api/v1/admin/tunnel/autostart",
                json={"enabled": True},
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        setter.assert_called_once_with(True)

        with patch("app.platform.system.routes.tunnel.stop", return_value=status):
            response = self.admin_client.delete(
                "/api/v1/admin/tunnel",
                headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["enabled"])

        forbidden = self.store_client.get("/api/v1/admin/tunnel")
        self.assertEqual(forbidden.status_code, 403)

    def test_tunnel_start_errors_are_reported_as_503(self):
        failed = {"enabled": False, "autostart": True, "has_token": False, "state": "error",
                  "public_url": "", "error": "cloudflared не встановлено на цьому сервері."}
        with patch("app.platform.system.routes.tunnel.start", return_value=failed):
            response = self.admin_client.post(
                "/api/v1/admin/tunnel", json={"confirm_public": True}, headers={"origin": "http://testserver"},
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("cloudflared", response.json()["detail"])

    def test_health_and_backups(self):
        with tempfile.TemporaryDirectory() as tmp:
            backups = Path(tmp)
            (backups / "reports-20261101-010000.db").write_bytes(b"x" * 10)
            (backups / "reports-20261102-010000-snapshot.db").write_bytes(b"y" * 20)
            with patch("app.db.backup.BACKUP_DIR", backups):
                listed = self.admin_client.get("/api/v1/admin/backups")
                health = self.admin_client.get("/api/v1/admin/system/health")
        self.assertEqual([b["name"] for b in listed.json()], ["reports-20261102-010000-snapshot.db", "reports-20261101-010000.db"])
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["backups_count"], 2)
        self.assertIn(health.json()["journal_mode"], {"wal", "delete"})
        self.assertEqual(self.store_client.get("/api/v1/admin/system/health").status_code, 403)


if __name__ == "__main__":
    unittest.main()
