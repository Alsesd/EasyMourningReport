"""Empirical stress tests for Cloudflare Tunnel endpoints and Tailscale eradication verification.

Covers:
1. Tailscale module, symbol, and OpenAPI route elimination assertions
2. Cloudflare Tunnel status, start/stop, autostart, and error handling
3. Authentication and role-based access control for /api/v1/admin/tunnel*
4. Stress testing GET /api/v1/admin/tunnel with corrupted status.json and log files
5. Stress testing PUT /api/v1/admin/tunnel/autostart with malformed inputs, type variations, OS errors, and concurrency
6. Stress testing POST and DELETE /api/v1/admin/tunnel validation rules and error responses
"""

import concurrent.futures
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import create_engine

import app.features.tunnel.service as tunnel_svc
from app.core.database import Base, get_db
from app.core.security import hash_pw
from app.features.auth.models import User
from app.features.stores.models import Store
from app.main import app


class TunnelStressTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["SECRET_KEY"] = "challenger-tunnel-test-secret"

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_root = Path(self.temp_dir.name)

        # Patch tunnel user_data_dir to point to isolated temp directory
        self.path_patcher = patch(
            "app.features.tunnel.service.user_data_dir",
            return_value=self.data_root,
        )
        self.path_patcher.start()

        # Database setup with in-memory SQLite for test auth
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)

        def override_get_db():
            with self.Session() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db

        with self.Session() as db:
            self.admin = User(
                login="testadmin",
                password_hash=hash_pw("adminsecret"),
                role="admin",
            )
            self.store = Store(name="Test Store")
            db.add_all([self.admin, self.store])
            db.flush()

            self.store_user = User(
                login="teststore",
                password_hash=hash_pw("storesecret"),
                role="store",
                store_id=self.store.id,
            )
            db.add(self.store_user)
            db.commit()

        # Set up authenticated TestClients
        self.admin_client = TestClient(app, follow_redirects=False)
        self.store_client = TestClient(app, follow_redirects=False)
        self.anon_client = TestClient(app, follow_redirects=False)

        admin_login = self.admin_client.post(
            "/login",
            data={"login": "testadmin", "password": "adminsecret"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(admin_login.status_code, 303)

        store_login = self.store_client.post(
            "/login",
            data={"login": "teststore", "password": "storesecret"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(store_login.status_code, 303)

    def tearDown(self):
        self.admin_client.close()
        self.store_client.close()
        self.anon_client.close()
        app.dependency_overrides.clear()
        self.path_patcher.stop()
        self.temp_dir.cleanup()
        self.engine.dispose()

    # =========================================================================
    # 1. Tailscale Eradication & 404 Verification
    # =========================================================================

    def test_tailscale_module_and_routes_completely_absent(self):
        """Assert no tailscale modules or route paths exist in application runtime."""
        import importlib.util

        spec = importlib.util.find_spec("app.core.tailscale")
        self.assertIsNone(spec, "app.core.tailscale must not exist")

        all_route_paths = app.openapi()["paths"]
        tailscale_routes = [
            p for p in all_route_paths if "tailscale" in p.lower()
        ]
        self.assertEqual(
            tailscale_routes,
            [],
            f"No tailscale routes should exist: {tailscale_routes}",
        )

        # Assert no obsolete tailscale symbols in tunnel_svc
        for obsolete_sym in (
            "start_tailscale_if_enabled",
            "shutdown_tailscale",
            "tailscale_status",
            "set_tailscale_autostart",
            "start_funnel",
            "stop_funnel",
        ):
            self.assertFalse(
                hasattr(tunnel_svc, obsolete_sym),
                f"tunnel_svc must not export {obsolete_sym}",
            )

    # =========================================================================
    # 2. Authentication & Authorization Boundaries
    # =========================================================================

    def test_tunnel_endpoints_reject_unauthenticated_requests(self):
        """Anonymous requests to /api/v1/admin/tunnel* must receive 401."""
        endpoints = [
            ("GET", "/api/v1/admin/tunnel", None),
            ("POST", "/api/v1/admin/tunnel", {"confirm_public": True}),
            ("PUT", "/api/v1/admin/tunnel/autostart", {"enabled": True}),
            ("DELETE", "/api/v1/admin/tunnel", None),
        ]
        for method, path, json_body in endpoints:
            resp = self.anon_client.request(
                method,
                path,
                json=json_body,
                headers={"origin": "http://testserver"},
            )
            self.assertEqual(
                resp.status_code,
                401,
                f"Expected 401 for anonymous {method} {path}, got {resp.status_code}",
            )
            self.assertEqual(resp.json().get("detail"), "Увійдіть у систему.")

    def test_tunnel_endpoints_reject_store_role(self):
        """Store users must receive 403 Forbidden for all /api/v1/admin/tunnel* endpoints."""
        endpoints = [
            ("GET", "/api/v1/admin/tunnel", None),
            ("POST", "/api/v1/admin/tunnel", {"confirm_public": True}),
            ("PUT", "/api/v1/admin/tunnel/autostart", {"enabled": True}),
            ("DELETE", "/api/v1/admin/tunnel", None),
        ]
        for method, path, json_body in endpoints:
            resp = self.store_client.request(
                method,
                path,
                json=json_body,
                headers={"origin": "http://testserver"},
            )
            self.assertEqual(
                resp.status_code,
                403,
                f"Expected 403 for store role {method} {path}, got {resp.status_code}",
            )
            self.assertEqual(
                resp.json().get("detail"), "Лише для адміністраторів."
            )

    # =========================================================================
    # 3. Stress Testing GET /api/v1/admin/tunnel
    # =========================================================================

    def test_get_tunnel_status_default_schema_and_no_credential_leak(self):
        """GET /admin/tunnel returns standard schema and never exposes credentials."""
        resp = self.admin_client.get("/api/v1/admin/tunnel")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        expected_keys = {"enabled", "autostart", "state", "public_url", "has_token", "error"}
        self.assertTrue(expected_keys.issubset(data.keys()))
        self.assertFalse(data["enabled"])
        self.assertEqual(data["state"], "disabled")
        self.assertEqual(data["public_url"], "")
        self.assertNotIn("token", data)
        self.assertNotIn("auth_key", data)
        self.assertNotIn("secret", data)

    def test_get_tunnel_status_resilience_to_corrupted_status_json(self):
        """GET /admin/tunnel must not crash with corrupted, partial, or malformed status.json."""
        tunnel_dir = self.data_root / "tunnel"
        tunnel_dir.mkdir(parents=True, exist_ok=True)
        status_file = tunnel_dir / "status.json"

        adversarial_contents = [
            "",  # empty
            "not a json",  # syntax error
            "{{{{",  # invalid braces
            "null",  # null JSON
            "12345",  # int
            '["array", "of", "items"]',  # list instead of dict
            '{"unexpected_key": 999}',  # missing expected keys
            '{"state": 1234, "public_url": [1, 2, 3]}',  # wrong types inside dict
        ]

        for content in adversarial_contents:
            status_file.write_text(content, encoding="utf-8")
            resp = self.admin_client.get("/api/v1/admin/tunnel")
            self.assertEqual(
                resp.status_code,
                200,
                f"Status query crashed on content: {content!r}",
            )
            data = resp.json()
            self.assertIn("state", data)
            self.assertIn("enabled", data)

    def test_get_tunnel_status_resilience_to_corrupted_cloudflared_log(self):
        """GET /admin/tunnel handles non-utf8 logs and huge logs gracefully."""
        tunnel_dir = self.data_root / "tunnel"
        tunnel_dir.mkdir(parents=True, exist_ok=True)
        log_file = tunnel_dir / "cloudflared.log"

        # Enable tunnel so log parsing triggers
        (self.data_root / ".tunnel-enabled").write_text("enabled\n", encoding="utf-8")

        # 1. Non-utf8 binary junk
        log_file.write_bytes(b"\xff\xfe\x00\x00\x80\x90random_binary_garbage\x00\xff")
        resp = self.admin_client.get("/api/v1/admin/tunnel")
        self.assertEqual(resp.status_code, 200)

        # 2. Huge 2MB log file with TryCloudflare URL at the very end
        large_lines = ["2026-10-26T12:00:00Z INF Normal dummy log message\n"] * 25000
        large_lines.append(
            "2026-10-26T12:05:00Z INF +--------------------------------------------------------------------------------------------+\n"
            "2026-10-26T12:05:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |\n"
            "2026-10-26T12:05:00Z INF |  https://adversarial-stress-test.trycloudflare.com                                         |\n"
            "2026-10-26T12:05:00Z INF +--------------------------------------------------------------------------------------------+\n"
        )
        log_file.write_text("".join(large_lines), encoding="utf-8")

        resp = self.admin_client.get("/api/v1/admin/tunnel")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(
            data["public_url"], "https://adversarial-stress-test.trycloudflare.com"
        )
        self.assertEqual(data["state"], "running")

    # =========================================================================
    # 4. Stress Testing PUT /api/v1/admin/tunnel/autostart
    # =========================================================================

    def test_put_tunnel_autostart_valid_round_trip(self):
        """PUT /admin/tunnel/autostart toggles .tunnel-enabled marker idempotently."""
        marker = self.data_root / ".tunnel-enabled"
        self.assertFalse(marker.exists())

        # Enable autostart
        r1 = self.admin_client.put(
            "/api/v1/admin/tunnel/autostart",
            json={"enabled": True},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(r1.status_code, 200)
        self.assertTrue(r1.json()["autostart"])
        self.assertTrue(marker.exists())

        # Repeated enable (idempotent)
        r2 = self.admin_client.put(
            "/api/v1/admin/tunnel/autostart",
            json={"enabled": True},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json()["autostart"])
        self.assertTrue(marker.exists())

        # Disable autostart
        r3 = self.admin_client.put(
            "/api/v1/admin/tunnel/autostart",
            json={"enabled": False},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(r3.status_code, 200)
        self.assertFalse(r3.json()["autostart"])
        self.assertFalse(marker.exists())

        # Repeated disable (idempotent)
        r4 = self.admin_client.put(
            "/api/v1/admin/tunnel/autostart",
            json={"enabled": False},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(r4.status_code, 200)
        self.assertFalse(r4.json()["autostart"])
        self.assertFalse(marker.exists())

    def test_put_tunnel_autostart_malformed_and_type_adversarial_payloads(self):
        """PUT /admin/tunnel/autostart strictly validates payload types, rejecting with 422."""
        invalid_payloads = [
            {},  # missing enabled
            {"enabled": "true"},  # string true
            {"enabled": "false"},  # string false
            {"enabled": "1"},  # string 1
            {"enabled": 1},  # int 1 (isinstance(1, bool) is False)
            {"enabled": 0},  # int 0
            {"enabled": None},  # null
            {"enabled": []},  # empty list
            {"enabled": [True]},  # list with bool
            {"enabled": {"nested": True}},  # nested dict
            {"wrong_key": True},  # wrong key
        ]

        for payload in invalid_payloads:
            resp = self.admin_client.put(
                "/api/v1/admin/tunnel/autostart",
                json=payload,
                headers={"origin": "http://testserver"},
            )
            self.assertEqual(
                resp.status_code,
                422,
                f"Expected 422 for payload {payload!r}, got {resp.status_code}: {resp.text}",
            )
            self.assertEqual(resp.json().get("detail"), "Некоректне значення автозапуску.")

    def test_put_tunnel_autostart_raw_malformed_json_and_empty_body(self):
        """PUT /admin/tunnel/autostart returns 422 on raw malformed JSON or empty body."""
        # Empty body
        r_empty = self.admin_client.put(
            "/api/v1/admin/tunnel/autostart",
            content=b"",
            headers={
                "origin": "http://testserver",
                "Content-Type": "application/json",
            },
        )
        self.assertEqual(r_empty.status_code, 422)

        # Truncated JSON
        r_malformed = self.admin_client.put(
            "/api/v1/admin/tunnel/autostart",
            content=b'{"enabled":',
            headers={
                "origin": "http://testserver",
                "Content-Type": "application/json",
            },
        )
        self.assertEqual(r_malformed.status_code, 422)

    def test_put_tunnel_autostart_handles_huge_payload(self):
        """PUT /admin/tunnel/autostart succeeds when valid 'enabled' is accompanied by huge extra metadata."""
        huge_extra = {f"dummy_key_{i}": f"dummy_val_{i}" * 10 for i in range(1000)}
        huge_payload = {"enabled": True, **huge_extra}

        resp = self.admin_client.put(
            "/api/v1/admin/tunnel/autostart",
            json=huge_payload,
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["autostart"])

    def test_put_tunnel_autostart_handles_filesystem_os_error(self):
        """PUT /admin/tunnel/autostart converts OSError into a clean 500 error."""
        with patch.object(
            Path, "write_text", side_effect=OSError("Read-only file system")
        ):
            resp = self.admin_client.put(
                "/api/v1/admin/tunnel/autostart",
                json={"enabled": True},
                headers={"origin": "http://testserver"},
            )
            self.assertEqual(resp.status_code, 500)
            self.assertIn("Read-only file system", resp.json().get("detail", ""))

    def test_put_tunnel_autostart_concurrent_stress(self):
        """High concurrency on PUT /admin/tunnel/autostart must not crash or corrupt state."""
        success_count = 0
        error_count = 0

        def toggle_autostart(i: int):
            state = bool(i % 2)
            res = self.admin_client.put(
                "/api/v1/admin/tunnel/autostart",
                json={"enabled": state},
                headers={"origin": "http://testserver"},
            )
            return res.status_code

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(toggle_autostart, i) for i in range(30)]
            for fut in concurrent.futures.as_completed(futures):
                status_code = fut.result()
                if status_code == 200:
                    success_count += 1
                else:
                    error_count += 1

        self.assertEqual(success_count, 30)
        self.assertEqual(error_count, 0)

        # State inquiry must remain operational
        final_check = self.admin_client.get("/api/v1/admin/tunnel")
        self.assertEqual(final_check.status_code, 200)

    # =========================================================================
    # 5. Stress Testing POST & DELETE /api/v1/admin/tunnel
    # =========================================================================

    def test_post_tunnel_confirm_public_validation(self):
        """POST /admin/tunnel requires confirm_public == True."""
        bad_confirms = [
            {},
            {"confirm_public": False},
            {"confirm_public": "true"},
            {"confirm_public": 1},
            {"confirm_public": None},
        ]
        for p in bad_confirms:
            resp = self.admin_client.post(
                "/api/v1/admin/tunnel",
                json=p,
                headers={"origin": "http://testserver"},
            )
            self.assertEqual(
                resp.status_code,
                400,
                f"Expected 400 for confirm_public {p!r}, got {resp.status_code}",
            )
            self.assertIn("Підтвердьте", resp.json().get("detail", ""))

    def test_post_tunnel_auth_key_and_autostart_types(self):
        """POST /admin/tunnel validates auth_key format and autostart boolean."""
        # Non-string auth_key
        resp_key = self.admin_client.post(
            "/api/v1/admin/tunnel",
            json={"confirm_public": True, "auth_key": 12345},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(resp_key.status_code, 422)
        self.assertEqual(resp_key.json().get("detail"), "Некоректний формат auth key.")

        # Non-bool autostart
        resp_auto = self.admin_client.post(
            "/api/v1/admin/tunnel",
            json={"confirm_public": True, "autostart": "yes"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(resp_auto.status_code, 422)
        self.assertEqual(resp_auto.json().get("detail"), "Некоректне значення автозапуску.")

        # Auth key newline injection
        resp_injection = self.admin_client.post(
            "/api/v1/admin/tunnel",
            json={"confirm_public": True, "auth_key": "secret\nkey"},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(resp_injection.status_code, 503)
        self.assertIn("Invalid auth key", resp_injection.json().get("detail", ""))

    def test_post_and_delete_tunnel_lifecycle(self):
        """POST /admin/tunnel starts/configures tunnel and DELETE stops it."""
        mock_status = {
            "enabled": True,
            "autostart": True,
            "has_token": True,
            "state": "running",
            "public_url": "https://active-tunnel.trycloudflare.com",
            "login_url": "",
            "error": "",
        }

        with patch("app.features.tunnel.service.start_tunnel", return_value=mock_status) as mock_start:
            resp_post = self.admin_client.post(
                "/api/v1/admin/tunnel",
                json={
                    "confirm_public": True,
                    "auth_key": "eyJhIjoidGVzdCJ9",
                    "autostart": True,
                },
                headers={"origin": "http://testserver"},
            )
            self.assertEqual(resp_post.status_code, 200)
            self.assertEqual(resp_post.json()["public_url"], "https://active-tunnel.trycloudflare.com")
            mock_start.assert_called_once_with("eyJhIjoidGVzdCJ9", autostart=True)

        mock_stopped = {
            "enabled": False,
            "autostart": True,
            "has_token": True,
            "state": "stopped",
            "public_url": "",
            "login_url": "",
            "error": "",
        }
        with patch("app.features.tunnel.service.stop_tunnel", return_value=mock_stopped) as mock_stop:
            resp_del = self.admin_client.delete(
                "/api/v1/admin/tunnel",
                headers={"origin": "http://testserver"},
            )
            self.assertEqual(resp_del.status_code, 200)
            self.assertEqual(resp_del.json()["state"], "stopped")
            mock_stop.assert_called_once()


if __name__ == "__main__":
    unittest.main()
