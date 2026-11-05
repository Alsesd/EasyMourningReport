"""The app-managed cloudflared process: preference, token, lifecycle and status."""

import os
import stat
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from app.platform.system import tunnel

FAKE_CLOUDFLARED = """#!/bin/sh
echo "args: $*"
exec sleep 30
"""
FAILING_CLOUDFLARED = """#!/bin/sh
echo "2026-11-05T10:00:00Z ERR Provided Tunnel token is not valid"
exit 1
"""


class TunnelTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"TUNNEL_TOKEN": "", "TUNNEL_ENABLED": "", "PUBLIC_URL": ""})
        self.env.start()

    def tearDown(self):
        tunnel.shutdown()
        self.env.stop()
        self.tmp.cleanup()

    def fake_binary(self, script: str) -> str:
        path = self.root / "cloudflared"
        path.write_text(script)
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        return str(path)

    def test_disabled_by_default(self):
        self.assertEqual(
            tunnel.status(self.root),
            {"enabled": False, "autostart": False, "has_token": False, "state": "disabled", "public_url": "", "error": ""},
        )
        self.assertIsNone(tunnel.start_if_enabled(self.root))

    def test_autostart_marker_and_legacy_tailscale_marker(self):
        self.assertTrue(tunnel.set_autostart(True, self.root)["autostart"])
        self.assertEqual(tunnel.status(self.root)["state"], "stopped")
        self.assertFalse(tunnel.set_autostart(False, self.root)["autostart"])
        (self.root / ".tailscale-funnel-enabled").write_text("enabled\n")
        self.assertTrue(tunnel.status(self.root)["autostart"])
        self.assertTrue((self.root / ".tunnel-enabled").is_file())
        self.assertFalse((self.root / ".tailscale-funnel-enabled").exists())

    def test_missing_cloudflared_is_reported(self):
        with patch.dict(os.environ, {"CLOUDFLARED_PATH": str(self.root / "missing")}):
            result = tunnel.start(root=self.root)
        self.assertEqual(result["state"], "error")
        self.assertIn("cloudflared", result["error"])

    def test_token_with_whitespace_is_rejected_and_not_saved(self):
        result = tunnel.start("abc def", root=self.root)
        self.assertEqual(result["state"], "error")
        self.assertFalse((self.root / "tunnel" / "token").exists())

    def test_named_tunnel_runs_with_saved_token_and_stops(self):
        binary = self.fake_binary(FAKE_CLOUDFLARED)
        with patch.dict(os.environ, {"CLOUDFLARED_PATH": binary, "PUBLIC_URL": "https://zvit.example.com"}), \
             patch.object(tunnel, "_metrics", side_effect=lambda path: {"readyConnections": 2} if path == "/ready" else None):
            started = tunnel.start("secret-token", root=self.root)
            self.assertEqual(started["state"], "running")
            self.assertEqual(started["public_url"], "https://zvit.example.com")
            self.assertTrue(started["has_token"])
            self.assertNotIn("secret-token", str(started))
            token_file = self.root / "tunnel" / "token"
            self.assertEqual(token_file.read_text(), "secret-token")
            self.assertEqual(stat.S_IMODE(token_file.stat().st_mode), 0o600)
            time.sleep(0.2)
            self.assertIn("run --token secret-token", (self.root / "tunnel" / "cloudflared.log").read_text())
            stopped = tunnel.stop(self.root)
        self.assertEqual(stopped["state"], "stopped")  # autostart stays on
        self.assertTrue(stopped["autostart"])

    def test_quick_tunnel_reports_trycloudflare_url(self):
        binary = self.fake_binary(FAKE_CLOUDFLARED)
        metrics = {"/ready": {"readyConnections": 1}, "/quicktunnel": {"hostname": "calm-river.trycloudflare.com"}}
        with patch.dict(os.environ, {"CLOUDFLARED_PATH": binary}), patch.object(tunnel, "_metrics", side_effect=metrics.get):
            result = tunnel.start(autostart=False, root=self.root)
        self.assertEqual(result["public_url"], "https://calm-river.trycloudflare.com")
        self.assertFalse(result["autostart"])
        time.sleep(0.2)
        self.assertIn("--url http://127.0.0.1:", (self.root / "tunnel" / "cloudflared.log").read_text())

    def test_crashed_process_surfaces_its_error(self):
        binary = self.fake_binary(FAILING_CLOUDFLARED)
        with patch.dict(os.environ, {"CLOUDFLARED_PATH": binary}):
            tunnel.start("bad-token", root=self.root)
            for _ in range(50):
                if tunnel._process is not None and tunnel._process.poll() is not None:
                    break
                time.sleep(0.05)
            result = tunnel.status(self.root)
        self.assertEqual(result["state"], "error")
        self.assertIn("token is not valid", result["error"])

    def test_start_if_enabled_rules(self):
        with patch.object(tunnel, "start", return_value={"state": "starting"}) as start:
            with patch.dict(os.environ, {"TUNNEL_ENABLED": "0", "TUNNEL_TOKEN": "x"}):
                self.assertIsNone(tunnel.start_if_enabled(self.root))
            with patch.dict(os.environ, {"TUNNEL_TOKEN": "x"}):
                self.assertEqual(tunnel.start_if_enabled(self.root), {"state": "starting"})
            tunnel.set_autostart(True, self.root)
            self.assertEqual(tunnel.start_if_enabled(self.root), {"state": "starting"})
        self.assertEqual(start.call_count, 2)


if __name__ == "__main__":
    unittest.main()
