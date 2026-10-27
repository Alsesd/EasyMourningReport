"""Coverage tests for the `python -m app` entry point and startup diagnostics."""

import importlib
import os
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch


class PackagedEntryPointTests(unittest.TestCase):
    def test_module_starts_uvicorn_and_reports_data_directory(self):
        sys.modules.pop("app.__main__", None)
        with patch.dict(os.environ, {}, clear=False):
            module = importlib.import_module("app.__main__")
            with patch("uvicorn.run") as run_server, patch("builtins.print") as output:
                module.main()

            run_server.assert_called_once()
            _, kwargs = run_server.call_args
            self.assertEqual(kwargs["host"], "127.0.0.1")
            self.assertEqual(kwargs["port"], int(os.environ.get("PORT", "8000")))
            self.assertTrue(output.called)
            self.assertIn("Data folder:", output.call_args.args[0])
        sys.modules.pop("app.__main__", None)

    def test_multipart_dependency_is_declared(self):
        root = Path(__file__).resolve().parents[3]
        config = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
        dependencies = config["project"]["dependencies"]
        self.assertTrue(
            any("python-multipart" in dependency for dependency in dependencies),
            "FastAPI file uploads require python-multipart",
        )

    def test_load_env_file(self):
        from app.core.env import load_env_file

        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text(
                "TEST_CUSTOM_VAR_XYZ=hello_world # inline comment\n"
                "TEST_QUOTED_VAR_XYZ='value # kept'\n"
                "# comment\nPORT=9999\n",
                encoding="utf-8",
            )
            previous_port = os.environ.pop("PORT", None)
            try:
                load_env_file(env_file)
                self.assertEqual(os.environ.get("TEST_CUSTOM_VAR_XYZ"), "hello_world")
                self.assertEqual(os.environ.get("TEST_QUOTED_VAR_XYZ"), "value # kept")
                self.assertEqual(os.environ.get("PORT"), "9999")
            finally:
                os.environ.pop("TEST_CUSTOM_VAR_XYZ", None)
                os.environ.pop("TEST_QUOTED_VAR_XYZ", None)
                if previous_port is not None:
                    os.environ["PORT"] = previous_port
                else:
                    os.environ.pop("PORT", None)

    def test_print_startup_banner_handles_probe_unlink_oserror(self):
        from app.core.startup import print_startup_banner

        with patch.object(Path, "unlink", side_effect=OSError("Lock")):
            with patch("builtins.print") as mock_print:
                print_startup_banner("0.0.0.0", 8000)
                self.assertTrue(mock_print.called)


if __name__ == "__main__":
    unittest.main()
