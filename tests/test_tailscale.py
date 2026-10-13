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

    def test_disable_clears_opt_in_and_stops_child(self):
        with patch("app.core.tailscale.subprocess.Popen", return_value=FakeProcess()):
            tailscale.start_funnel()
        result = tailscale.stop_funnel()
        self.assertFalse(result["enabled"])
        self.assertFalse((self.root / ".tailscale-funnel-enabled").exists())


    def test_helper_override_is_resolved_and_missing_override_is_rejected(self):
        with patch.dict(os.environ, {"LEGKYI_TAILSCALE_HELPER": str(self.helper)}):
            self.assertEqual(tailscale._helper_path(), self.helper)
        with patch.dict(os.environ, {"LEGKYI_TAILSCALE_HELPER": str(self.root / "missing.exe")}):
            self.assertIsNone(tailscale._helper_path())

    def test_status_reads_saved_fields_and_marks_exited_child_stopped(self):
        (self.root / ".tailscale-funnel-enabled").write_text("enabled", encoding="utf-8")
        state_path = self.root / "tailscale" / "status.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps({
            "state": "running",
            "public_url": "https://example.ts.net",
            "login_url": "https://login.tailscale.com/example",
            "error": "",
            "updated_at": "2026-10-13T00:00:00Z",
            "ignored": "not copied",
            "bad_type": 42,
        }), encoding="utf-8")
        fake = FakeProcess()
        fake.returncode = 1
        tailscale._process = fake
        result = tailscale.get_status()
        self.assertEqual(result["state"], "stopped")
        self.assertEqual(result["public_url"], "https://example.ts.net")
        self.assertEqual(result["updated_at"], "2026-10-13T00:00:00Z")
        self.assertNotIn("ignored", result)
        self.assertNotIn("bad_type", result)

    def test_disabled_status_clears_stale_urls(self):
        state_path = self.root / "tailscale" / "status.json"
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps({
            "state": "running",
            "public_url": "https://stale.ts.net",
            "login_url": "https://login.tailscale.com/stale",
        }), encoding="utf-8")
        result = tailscale.get_status()
        self.assertEqual(result["state"], "disabled")
        self.assertEqual(result["public_url"], "")
        self.assertEqual(result["login_url"], "")

    def test_start_rejects_bad_key_and_missing_helper(self):
        invalid = tailscale.start_funnel("bad\nkey")
        self.assertEqual(invalid["state"], "error")
        self.assertIn("Invalid auth key", invalid["error"])
        with patch("app.core.tailscale._helper_path", return_value=None):
            missing = tailscale.start_funnel()
        self.assertEqual(missing["state"], "error")
        self.assertIn("helper is missing", missing["error"])

    def test_repeated_start_reuses_process_and_auth_key_restarts_it(self):
        first, second = FakeProcess(), FakeProcess()
        with patch("app.core.tailscale.subprocess.Popen", side_effect=[first, second]) as popen:
            tailscale.start_funnel()
            tailscale.start_funnel()
            self.assertEqual(popen.call_count, 1)
            tailscale.start_funnel("tskey-retry")
            self.assertEqual(popen.call_count, 2)
        self.assertEqual(first.returncode, 0)
        self.assertEqual(second.stdin.data, b"tskey-retry\n")

    def test_start_failure_returns_error_and_closes_log(self):
        with patch("app.core.tailscale.subprocess.Popen", side_effect=OSError("process denied")):
            result = tailscale.start_funnel()
        self.assertEqual(result["state"], "error")
        self.assertIn("process denied", result["error"])
        self.assertIsNone(tailscale._log_handle)

    def test_start_if_enabled_retries_persistent_opt_in(self):
        (self.root / ".tailscale-funnel-enabled").write_text("enabled", encoding="utf-8")
        expected = {"enabled": True, "state": "running"}
        with patch("app.core.tailscale.start_funnel", return_value=expected) as start:
            self.assertEqual(tailscale.start_if_enabled(), expected)
        start.assert_called_once_with()

    def test_stop_reports_marker_removal_failure(self):
        with patch("app.core.tailscale._enabled_file", return_value=self.root / "blocked"):
            with patch("pathlib.Path.unlink", side_effect=OSError("read only")):
                result = tailscale.stop_funnel()
        self.assertEqual(result["state"], "error")
        self.assertIn("read only", result["error"])

    def test_stop_child_kills_process_after_timeout(self):
        class StuckProcess(FakeProcess):
            def __init__(self):
                super().__init__()
                self.wait_calls = 0
            def wait(self, timeout=None):
                self.wait_calls += 1
                if self.wait_calls == 1:
                    raise tailscale.subprocess.TimeoutExpired("helper", timeout)
                return self.returncode
            def kill(self):
                self.returncode = -9

        stuck = StuckProcess()
        tailscale._process = stuck
        tailscale._stop_child()
        self.assertEqual(stuck.returncode, -9)
        self.assertIsNone(tailscale._process)


if __name__ == "__main__":
    unittest.main()
