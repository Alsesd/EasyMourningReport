"""Backward-compatible Tailscale facade for the unified tunnel infrastructure."""

import os
from pathlib import Path
from typing import Any

from app.core import tunnel
from app.core.paths import user_data_dir


def _state_root() -> Path:
    path = user_data_dir() / "tailscale"
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        try:
            path.chmod(0o700)
        except OSError:
            pass
    return path


def _enabled_file() -> Path:
    return tunnel._enabled_file(user_data_dir())


def get_status() -> dict[str, Any]:
    return tunnel.get_status(root=user_data_dir())


def set_autostart(enabled: bool) -> dict[str, Any]:
    return tunnel.set_autostart(enabled, root=user_data_dir())


def start_funnel(auth_key: str | None = None, autostart: bool = True) -> dict[str, Any]:
    return tunnel.start_tunnel(auth_key=auth_key, autostart=autostart, root=user_data_dir())


def stop_funnel() -> dict[str, Any]:
    return tunnel.stop_tunnel(root=user_data_dir())


def start_if_enabled() -> dict[str, Any] | None:
    return tunnel.start_if_enabled(root=user_data_dir())


def shutdown() -> None:
    tunnel.shutdown()


start_tunnel = start_funnel
stop_tunnel = stop_funnel
