"""Tests for Tailscale opt-in state and auth-key handling."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.core import tailscale


class FakePipe:
    def __init__(self):
        self.data = b""
        self.closed = False

    def write(self, value):
        self.data += value

    def close(self):
        self.closed = True


class FakeProcess:
    def __init__(self):
        self.returncode = None
        self.stdin = FakePipe()

    def poll(self):
        return self.returncode

    def terminate(self):
        self.returncode = 0

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        self.returncode = -9


class TailscaleManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_process = tailscale._process
        self.old_log = tailscale._log_handle
        tailscale._process = None
        tailscale._log_handle = None
        self.patcher = patch("app.core.tailscale.user_data_dir", return_value=self.root)
        self.patcher.start()
        self.helper = self.root / ("tailscale-helper.exe" if os.name == "nt" else "tailscale-helper")
        self.helper.write_text("test helper", encoding="utf-8")
        self.helper_patch = patch("app.core.tailscale._helper_path", return_value=self.helper)
        self.helper_patch.start()

    def tearDown(self):
        tailscale.shutdown()
        self.helper_patch.stop()
        self.patcher.stop()
        tailscale._process = self.old_process
        tailscale._log_handle = self.old_log
        self.temp.cleanup()

    def test_funnel_is_not_opted_in_by_default(self):
        self.assertFalse(tailscale.get_status()["enabled"])
        self.assertIsNone(tailscale.start_if_enabled())

    def test_auth_key_is_only_passed_over_stdin(self):
        fake = FakeProcess()
        with patch("app.core.tailscale.subprocess.Popen", return_value=fake) as popen:
            tailscale.start_funnel("tskey-test-secret")
        args, kwargs = popen.call_args
        self.assertNotIn("tskey-test-secret", args[0])
        self.assertNotIn("TS_AUTHKEY", kwargs["env"])
        self.assertNotIn("TS_AUTH_KEY", kwargs["env"])
        self.assertIn("--auth-key-stdin", args[0])
        self.assertEqual(kwargs["stdin"], -1)  # subprocess.PIPE
        self.assertEqual(fake.stdin.data, b"tskey-test-secret\n")
        self.assertTrue(fake.stdin.closed)
        self.assertNotIn("tskey-test-secret", (self.root / ".tailscale-funnel-enabled").read_text())
        self.assertNotIn("tskey-test-secret", json.dumps(tailscale.get_status()))

    def test_shutdown_preserves_explicit_opt_in_for_next_start(self):
        with patch("app.core.tailscale.subprocess.Popen", return_value=FakeProcess()):
            tailscale.start_funnel()
        tailscale.shutdown()
        self.assertTrue((self.root / ".tailscale-funnel-enabled").exists())
        self.assertIsNone(tailscale._process)

    def test_disconnect_stops_child_but_preserves_autostart(self):
        with patch("app.core.tailscale.subprocess.Popen", return_value=FakeProcess()):
            tailscale.start_funnel()
        result = tailscale.stop_funnel()
        self.assertTrue(result["autostart"])
        self.assertTrue(result["enabled"])
        self.assertEqual(result["state"], "enabled-but-not-running")
        self.assertTrue((self.root / ".tailscale-funnel-enabled").exists())
        self.assertFalse((self.root / "tailscale" / "status.json").exists())
        self.assertIsNone(tailscale._process)

    def test_autostart_can_be_disabled_without_disconnecting(self):
        fake = FakeProcess()
        with patch("app.core.tailscale.subprocess.Popen", return_value=fake):
            tailscale.start_funnel()
            result = tailscale.set_autostart(False)
        self.assertTrue(result["enabled"])
        self.assertFalse(result["autostart"])
        self.assertIs(tailscale._process, fake)
        self.assertIsNone(fake.returncode)
        self.assertFalse((self.root / ".tailscale-funnel-enabled").exists())

    def test_connect_without_autostart_still_reports_active_session(self):
        fake = FakeProcess()
        with patch("app.core.tailscale.subprocess.Popen", return_value=fake):
            result = tailscale.start_funnel(autostart=False)
        self.assertTrue(result["enabled"])
        self.assertFalse(result["autostart"])
        self.assertEqual(result["state"], "starting")
        self.assertIs(tailscale._process, fake)
        self.assertFalse((self.root / ".tailscale-funnel-enabled").exists())

    def test_auth_key_never_persisted_in_marker_or_status(self):
        fake = FakeProcess()
        with patch("app.core.tailscale.subprocess.Popen", return_value=fake) as popen:
            tailscale.start_funnel("tskey-test-secret")
        args, kwargs = popen.call_args
        self.assertNotIn("tskey-test-secret", args[0])
        self.assertNotIn("TS_AUTHKEY", kwargs["env"])
        self.assertNotIn("TS_AUTH_KEY", kwargs["env"])
        self.assertEqual(fake.stdin.data, b"tskey-test-secret\n")
        self.assertTrue(fake.stdin.closed)
        self.assertNotIn("tskey-test-secret", (self.root / ".tailscale-funnel-enabled").read_text())
        self.assertNotIn("tskey-test-secret", json.dumps(tailscale.get_status()))


if __name__ == "__main__":
    unittest.main()
