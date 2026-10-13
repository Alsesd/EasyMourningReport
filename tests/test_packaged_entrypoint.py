"""Regression tests for source and packaged entry points."""

import importlib
import runpy
import socket
import sys
import unittest
from unittest.mock import patch


class PackagedEntryPointTests(unittest.TestCase):
    def test_importing_module_does_not_start_server_as_a_side_effect(self):
        sys.modules.pop("app.__main__", None)
        with patch("app.launcher.server_start") as start_server:
            importlib.import_module("app.__main__")

        start_server.assert_not_called()
        sys.modules.pop("app.__main__", None)

    def test_packaged_entrypoint_starts_shared_launcher_when_executed(self):
        with patch("app.launcher.server_start") as start_server, patch("builtins.print") as output:
            runpy.run_path("app/__main__.py", run_name="__main__")

        start_server.assert_called_once_with()
        self.assertIn("Data folder:", output.call_args.args[0])

    def test_default_port_conflict_uses_an_available_fallback(self):
        from app.launcher import _bind_available_socket

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
            occupied.bind(("127.0.0.1", 0))
            occupied.listen()
            occupied_port = occupied.getsockname()[1]
            if occupied_port >= 65400:
                self.skipTest("No safe high port range remains for the fallback test.")

            listener, selected_port = _bind_available_socket(
                "127.0.0.1",
                occupied_port,
                allow_fallback=True,
                attempts=100,
            )
            try:
                self.assertGreater(selected_port, occupied_port)
                self.assertEqual(listener.getsockname()[1], selected_port)
            finally:
                listener.close()

    def test_run_py_calls_launcher_without_passing_data_path_as_host(self):
        with patch("app.launcher.server_start") as start_server, patch("builtins.print") as output:
            runpy.run_path("run.py", run_name="__main__")

        start_server.assert_called_once_with()
        self.assertIn("Data folder:", output.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
