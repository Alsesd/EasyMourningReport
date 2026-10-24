"""Tests for unified Tunnel preference and status layer."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core import tunnel


class TunnelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patcher = patch("app.core.tunnel.user_data_dir", return_value=self.root)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.temp.cleanup()

    def test_disabled_by_default(self):
        status = tunnel.get_status()
        self.assertFalse(status["enabled"])
        self.assertEqual(status["state"], "disabled")
        self.assertEqual(status["public_url"], "")

    def test_start_if_enabled_returns_none_when_disabled(self):
        self.assertIsNone(tunnel.start_if_enabled())

    def test_set_autostart_creates_markers(self):
        tunnel.set_autostart(True)
        self.assertTrue((self.root / ".tunnel-enabled").exists())
        self.assertTrue((self.root / ".tailscale-funnel-enabled").exists())
        status = tunnel.get_status()
        self.assertTrue(status["autostart"])

    def test_set_autostart_false_removes_markers(self):
        (self.root / ".tunnel-enabled").write_text("enabled\n", encoding="utf-8")
        (self.root / ".tailscale-funnel-enabled").write_text("enabled\n", encoding="utf-8")
        tunnel.set_autostart(False)
        self.assertFalse((self.root / ".tunnel-enabled").exists())
        self.assertFalse((self.root / ".tailscale-funnel-enabled").exists())
        status = tunnel.get_status()
        self.assertFalse(status["autostart"])
        self.assertEqual(status["state"], "disabled")

    def test_start_tunnel_records_preference(self):
        result = tunnel.start_tunnel(autostart=True)
        self.assertTrue((self.root / ".tunnel-enabled").exists())
        self.assertTrue(result["autostart"])

    def test_start_tunnel_rejects_bad_key(self):
        result = tunnel.start_tunnel("bad\nkey")
        self.assertEqual(result["state"], "error")
        self.assertIn("Invalid auth key", result["error"])

    def test_start_tunnel_without_autostart(self):
        result = tunnel.start_tunnel(autostart=False)
        self.assertFalse((self.root / ".tunnel-enabled").exists())

    def test_stop_tunnel_clears_status_files(self):
        tunnel_dir = self.root / "tunnel"
        tunnel_dir.mkdir(parents=True, exist_ok=True)
        (tunnel_dir / "status.json").write_text('{"state":"running"}', encoding="utf-8")

        ts_dir = self.root / "tailscale"
        ts_dir.mkdir(parents=True, exist_ok=True)
        (ts_dir / "status.json").write_text('{"state":"running"}', encoding="utf-8")

        tunnel.stop_tunnel()
        self.assertFalse((tunnel_dir / "status.json").exists())
        self.assertFalse((ts_dir / "status.json").exists())

    def test_status_reads_saved_fields(self):
        (self.root / ".tunnel-enabled").write_text("enabled\n", encoding="utf-8")
        state_dir = self.root / "tunnel"
        state_dir.mkdir(parents=True, exist_ok=True)
        (state_dir / "status.json").write_text(json.dumps({
            "state": "running",
            "public_url": "https://random.trycloudflare.com",
            "login_url": "",
            "error": "",
            "updated_at": "2026-10-20T00:00:00Z",
        }), encoding="utf-8")
        result = tunnel.get_status()
        self.assertEqual(result["state"], "running")
        self.assertEqual(result["public_url"], "https://random.trycloudflare.com")
        self.assertEqual(result["updated_at"], "2026-10-20T00:00:00Z")

    def test_status_reads_fallback_tailscale_fields(self):
        (self.root / ".tailscale-funnel-enabled").write_text("enabled\n", encoding="utf-8")
        state_dir = self.root / "tailscale"
        state_dir.mkdir(parents=True, exist_ok=True)
        (state_dir / "status.json").write_text(json.dumps({
            "state": "running",
            "public_url": "https://example.ts.net",
            "login_url": "",
            "error": "",
            "updated_at": "2026-10-20T00:00:00Z",
        }), encoding="utf-8")
        result = tunnel.get_status()
        self.assertEqual(result["state"], "running")
        self.assertEqual(result["public_url"], "https://example.ts.net")

    def test_disabled_status_clears_stale_urls(self):
        state_dir = self.root / "tunnel"
        state_dir.mkdir(parents=True, exist_ok=True)
        (state_dir / "status.json").write_text(json.dumps({
            "state": "running",
            "public_url": "https://stale.trycloudflare.com",
            "login_url": "https://login.example.com",
        }), encoding="utf-8")
        result = tunnel.get_status()
        self.assertEqual(result["state"], "disabled")
        self.assertEqual(result["public_url"], "")
        self.assertEqual(result["login_url"], "")

    def test_start_if_enabled_returns_status_when_enabled(self):
        (self.root / ".tunnel-enabled").write_text("enabled\n", encoding="utf-8")
        result = tunnel.start_if_enabled()
        self.assertIsNotNone(result)
        self.assertTrue(result["enabled"])

    def test_environment_override_public_url(self):
        with patch.dict("os.environ", {"PUBLIC_URL": "https://custom.domain.com"}):
            status = tunnel.get_status()
            self.assertEqual(status["public_url"], "https://custom.domain.com")
            self.assertEqual(status["state"], "running")

    def test_shutdown_is_noop(self):
        tunnel.shutdown()

    def test_status_extracts_custom_domain_from_cloudflared_log(self):
        (self.root / ".tunnel-enabled").write_text("enabled\n", encoding="utf-8")
        state_dir = self.root / "tunnel"
        state_dir.mkdir(parents=True, exist_ok=True)
        log_content = (
            '2026-10-24T22:10:41Z INF Updated to new configuration '
            'config="{\\"ingress\\":[{\\"hostname\\":\\"mourningreport.pp.ua\\", \\"service\\":\\"http://0.0.0.0:8000\\"}]}"\n'
            '2026-10-24T22:10:41Z INF Registered tunnel connection connIndex=0 location=kbp02 protocol=quic\n'
        )
        (state_dir / "cloudflared.log").write_text(log_content, encoding="utf-8")
        status = tunnel.get_status()
        self.assertEqual(status["state"], "running")
        self.assertEqual(status["public_url"], "https://mourningreport.pp.ua")

    def test_token_persistence_across_restarts(self):
        token_value = "eyJhIjoidGVzdCIsInQiOiJ0dW5uZWwtaWQiLCJzIjoic2VjcmV0In0="
        tunnel.start_tunnel(auth_key=token_value, autostart=True)
        token_path = self.root / "tunnel" / "token"
        self.assertTrue(token_path.exists())
        self.assertEqual(token_path.read_text(encoding="utf-8").strip(), token_value)

        # After stop_tunnel, token remains preserved for restart
        tunnel.stop_tunnel()
        self.assertTrue(token_path.exists())
        self.assertEqual(token_path.read_text(encoding="utf-8").strip(), token_value)

    def test_start_and_stop_tunnel_clears_running_state(self):
        tunnel.start_tunnel(autostart=True)
        state_dir = self.root / "tunnel"
        (state_dir / "cloudflared.log").write_text("INF Registered tunnel connection\n", encoding="utf-8")
        s1 = tunnel.get_status()
        self.assertEqual(s1["state"], "running")

        s2 = tunnel.stop_tunnel()
        self.assertNotEqual(s2["state"], "running")
        self.assertIn(s2["state"], ("stopped", "enabled-but-not-running"))
        self.assertFalse((state_dir / "cloudflared.log").exists())
        self.assertFalse((state_dir / "status.json").exists())


if __name__ == "__main__":
    unittest.main()
