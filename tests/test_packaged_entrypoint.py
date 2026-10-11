"""Coverage tests for the standalone executable entry point."""

import importlib
import sys
import unittest
from unittest.mock import patch


class PackagedEntryPointTests(unittest.TestCase):
    def test_module_starts_uvicorn_and_reports_data_directory(self):
        sys.modules.pop("app.__main__", None)
        with patch("uvicorn.run") as run_server, patch("builtins.print") as output:
            importlib.import_module("app.__main__")

        run_server.assert_called_once()
        args, kwargs = run_server.call_args
        self.assertEqual(kwargs["host"], "127.0.0.1")
        self.assertEqual(kwargs["port"], 8000)
        self.assertTrue(output.called)
        self.assertIn("Data folder:", output.call_args.args[0])
        sys.modules.pop("app.__main__", None)


if __name__ == "__main__":
    unittest.main()
