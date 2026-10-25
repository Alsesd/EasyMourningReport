"""Coverage tests for the standalone executable entry point."""

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class PackagedEntryPointTests(unittest.TestCase):
    def test_module_starts_uvicorn_and_reports_data_directory(self):
        sys.modules.pop("app.__main__", None)
        with patch("uvicorn.run") as run_server, patch("builtins.print") as output:
            importlib.import_module("app.__main__")

        run_server.assert_called_once()
        args, kwargs = run_server.call_args
        self.assertEqual(kwargs["host"], "127.0.0.1")
        self.assertEqual(kwargs["port"], int(os.environ.get("PORT", "8000")))
        self.assertTrue(output.called)
        self.assertIn("Data folder:", output.call_args.args[0])
        sys.modules.pop("app.__main__", None)

    def test_run_py_load_env_file(self):
        import run

        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text("TEST_CUSTOM_VAR_XYZ=hello_world\n# comment\nPORT=9999\n", encoding="utf-8")
            run._load_env_file(env_file)
            self.assertEqual(os.environ.get("TEST_CUSTOM_VAR_XYZ"), "hello_world")
            # Clean up
            os.environ.pop("TEST_CUSTOM_VAR_XYZ", None)

    def test_print_startup_banner_handles_probe_unlink_oserror(self):
        import run
        with patch.object(Path, "unlink", side_effect=OSError("Lock")):
            with patch("builtins.print") as mock_print:
                run.print_startup_banner("0.0.0.0", 8000)
                # Should not crash, and should print banner
                self.assertTrue(mock_print.called)


if __name__ == "__main__":
    unittest.main()
