"""Tests for Tailscale tunnel preference and status layer."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core import tailscale


class TailscaleTunnelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patcher = patch("app.core.tailscale.user_data_dir", return_value=self.root)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.temp.cleanup()

    def test_disabled_by_default(self):
        status = tailscale.get_status()
        self.assertFalse(status["enabled"])
        self.assertEqual(status["state"], "disabled")
        self.assertEqual(status["public_url"], "")

    def test_start_if_enabled_returns_none_when_disabled(self):
        self.assertIsNone(tailscale.start_if_enabled())

    def test_set_autostart_creates_marker(self):
        tailscale.set_autostart(True)
        self.assertTrue((self.root / ".tailscale-funnel-enabled").exists())
        status = tailscale.get_status()
        self.assertTrue(status["autostart"])

    def test_set_autostart_false_removes_marker(self):
        (self.root / ".tailscale-funnel-enabled").write_text("enabled\n", encoding="utf-8")
        tailscale.set_autostart(False)
        self.assertFalse((self.root / ".tailscale-funnel-enabled").exists())
        status = tailscale.get_status()
        self.assertFalse(status["autostart"])
        self.assertEqual(status["state"], "disabled")

    def test_start_funnel_records_preference(self):
        result = tailscale.start_funnel(autostart=True)
        self.assertTrue((self.root / ".tailscale-funnel-enabled").exists())
        self.assertTrue(result["autostart"])

    def test_start_funnel_rejects_bad_key(self):
        result = tailscale.start_funnel("bad\nkey")
        self.assertEqual(result["state"], "error")
        self.assertIn("Invalid auth key", result["error"])

    def test_start_funnel_without_autostart(self):
        result = tailscale.start_funnel(autostart=False)
        self.assertFalse((self.root / ".tailscale-funnel-enabled").exists())

    def test_stop_funnel_clears_status_file(self):
        state_dir = self.root / "tailscale"
        state_dir.mkdir(parents=True, exist_ok=True)
        (state_dir / "status.json").write_text('{"state":"running"}', encoding="utf-8")
        tailscale.stop_funnel()
        self.assertFalse((state_dir / "status.json").exists())

    def test_status_reads_saved_fields(self):
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
        result = tailscale.get_status()
        self.assertEqual(result["state"], "running")
        self.assertEqual(result["public_url"], "https://example.ts.net")
        self.assertEqual(result["updated_at"], "2026-10-20T00:00:00Z")

    def test_disabled_status_clears_stale_urls(self):
        state_dir = self.root / "tailscale"
        state_dir.mkdir(parents=True, exist_ok=True)
        (state_dir / "status.json").write_text(json.dumps({
            "state": "running",
            "public_url": "https://stale.ts.net",
            "login_url": "https://login.tailscale.com/stale",
        }), encoding="utf-8")
        result = tailscale.get_status()
        self.assertEqual(result["state"], "disabled")
        self.assertEqual(result["public_url"], "")
        self.assertEqual(result["login_url"], "")

    def test_start_if_enabled_returns_status_when_enabled(self):
        (self.root / ".tailscale-funnel-enabled").write_text("enabled\n", encoding="utf-8")
        result = tailscale.start_if_enabled()
        self.assertIsNotNone(result)
        self.assertTrue(result["enabled"])

    def test_autostart_reports_marker_removal_failure(self):
        with patch("app.core.tailscale._enabled_file", return_value=self.root / "blocked"):
            with patch("pathlib.Path.unlink", side_effect=OSError("read only")):
                with self.assertRaisesRegex(OSError, "read only"):
                    tailscale.set_autostart(False)

    def test_shutdown_is_noop(self):
        # shutdown() should complete without error in container mode
        tailscale.shutdown()


if __name__ == "__main__":
    unittest.main()
