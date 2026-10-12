"""Coverage tests for source and packaged entry points."""

import importlib
import os
import runpy
import sys
import unittest
from unittest.mock import patch


class PackagedEntryPointTests(unittest.TestCase):
    def test_module_starts_uvicorn_and_reports_data_directory(self):
        sys.modules.pop("app.__main__", None)
        with patch("uvicorn.run") as run_server, patch("builtins.print") as output:
            importlib.import_module("app.__main__")

        run_server.assert_called_once()
        _, kwargs = run_server.call_args
        self.assertEqual(kwargs["host"], "127.0.0.1")
        self.assertEqual(kwargs["port"], int(os.environ.get("PORT", "8000")))
        self.assertTrue(output.called)
        self.assertIn("Data folder:", output.call_args.args[0])
        sys.modules.pop("app.__main__", None)

    def test_run_py_calls_launcher_without_passing_data_path_as_host(self):
        with patch("app.launcher.server_start") as start, patch("builtins.print") as output:
            runpy.run_path("run.py", run_name="__main__")

        start.assert_called_once_with()
        self.assertIn("Data folder:", output.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
