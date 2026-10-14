"""Regression tests for the shared source and PyInstaller launcher."""

from unittest.mock import patch

from app.main import app
from app.launcher import server_start


def test_server_start_delegates_to_uvicorn_with_explicit_host_and_port():
    with patch("app.launcher.uvicorn.run") as run:
        server_start("127.0.0.1", 8123)
    run.assert_called_once_with(app, host="127.0.0.1", port=8123)
