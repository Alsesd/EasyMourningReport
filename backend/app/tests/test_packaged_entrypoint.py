"""Tests for the single executable entry point (``python -m app``)."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import __main__ as entrypoint


class PackagedEntryPointTests(unittest.TestCase):
    def test_main_starts_uvicorn_and_reports_data_directory(self):
        with patch("app.__main__.uvicorn.run") as run_server, patch("builtins.print") as output:
            entrypoint.main()

        run_server.assert_called_once()
        _, kwargs = run_server.call_args
        self.assertEqual(kwargs["host"], os.getenv("HOST", "127.0.0.1"))
        self.assertEqual(kwargs["port"], int(os.environ.get("PORT", "8000")))
        self.assertTrue(output.called)
        self.assertIn("Data folder:", output.call_args.args[0])

    def test_env_file_loader_does_not_override_existing_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text(
                "TEST_CUSTOM_VAR_XYZ=hello_world\n# comment\nPORT=9999\n",
                encoding="utf-8",
            )
            os.environ.pop("TEST_CUSTOM_VAR_XYZ", None)
            entrypoint._load_env_file(env_file)
            self.assertEqual(os.environ.get("TEST_CUSTOM_VAR_XYZ"), "hello_world")
            os.environ.pop("TEST_CUSTOM_VAR_XYZ", None)

    def test_startup_banner_handles_probe_unlink_oserror(self):
        with patch.object(Path, "unlink", side_effect=OSError("Lock")):
            with patch("builtins.print") as mock_print:
                entrypoint.print_startup_banner("0.0.0.0", 8000)
                self.assertTrue(mock_print.called)


if __name__ == "__main__":
    unittest.main()
