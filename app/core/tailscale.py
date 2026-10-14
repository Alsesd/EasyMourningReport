"""Lifecycle and persistent opt-in for the app-specific Tailscale helper.

Auth keys are passed to the helper over stdin only; they are never written to
disk, included in command-line arguments, or placed in the child environment.
A public Funnel is attempted at startup only after an administrator has opted in.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from app.core.paths import user_data_dir

_process: subprocess.Popen | None = None
_log_handle = None


def _state_root() -> Path:
    path = user_data_dir() / "tailscale"
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        path.chmod(0o700)
    return path


def _enabled_file() -> Path:
    return user_data_dir() / ".tailscale-funnel-enabled"


def _helper_path() -> Path | None:
    override = os.getenv("LEGKYI_TAILSCALE_HELPER")
    if override:
        candidate = Path(override).expanduser()
        return candidate if candidate.is_file() else None

    executable_name = "tailscale-helper.exe" if os.name == "nt" else "tailscale-helper"
    roots = [
        Path(sys.executable).resolve().parent,
        Path(sys.argv[0]).resolve().parent,
        # PyInstaller --onefile extracts bundled binaries into _MEIPASS.
        Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2])),
        Path(__file__).resolve().parents[2] / "tailscale-helper" / "bin",
        Path(__file__).resolve().parents[2] / "build",
    ]
    for root in roots:
        candidate = root / executable_name
        if candidate.is_file():
            return candidate
    return None


def get_status() -> dict[str, Any]:
    """Return helper runtime state and the separate persistent autostart preference."""
    autostart = _enabled_file().is_file()
    process_running = _process is not None and _process.poll() is None
    result: dict[str, Any] = {
        "enabled": bool(autostart or process_running),
        "autostart": autostart,
        "state": "starting" if process_running else ("enabled-but-not-running" if autostart else "disabled"),
        "public_url": "",
        "login_url": "",
        "error": "",
    }
    status_path = _state_root() / "status.json"
    try:
        stored = json.loads(status_path.read_text(encoding="utf-8"))
        if isinstance(stored, dict):
            for key in ("state", "public_url", "login_url", "error", "updated_at"):
                if isinstance(stored.get(key), str):
                    result[key] = stored[key]
    except (OSError, ValueError):
        pass

    if process_running:
        # A live process with an empty/old snapshot has just been started.
        if result["state"] in ("disabled", "stopped", "enabled-but-not-running"):
            result.update(state="starting", public_url="", login_url="", error="")
        result["enabled"] = True
    elif _process is not None:
        # The child exited. Do not keep advertising a stale Funnel URL.
        if result["error"]:
            result.update(state="error", public_url="", login_url="")
        elif autostart:
            result.update(state="stopped", public_url="", login_url="")
        else:
            result.update(state="disabled", enabled=False, public_url="", login_url="", error="")
    elif autostart:
        # Autostart enabled is not the same as an active connection.
        if result["state"] != "error":
            result.update(state="enabled-but-not-running", public_url="", login_url="")
        result["enabled"] = True
    else:
        # No process and no startup preference: any saved status is stale.
        result.update(state="disabled", enabled=False, public_url="", login_url="", error="")
    return result


def set_autostart(enabled: bool) -> dict[str, Any]:
    """Change startup behavior without connecting or disconnecting the current session."""
    marker = _enabled_file()
    try:
        if enabled:
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text("enabled\n", encoding="utf-8")
            if os.name != "nt":
                marker.chmod(0o600)
        else:
            marker.unlink(missing_ok=True)
    except OSError as exc:
        raise OSError(f"Could not update Tailscale autostart: {exc}") from exc
    return get_status()


def start_funnel(
    auth_key: str | None = None, *, autostart: bool = True
) -> dict[str, Any]:
    """Start Funnel after applying the startup preference; never persist the auth key."""
    global _process, _log_handle

    supplied_key = (auth_key or "").strip()
    if "\n" in supplied_key or "\r" in supplied_key:
        return {**get_status(), "state": "error", "error": "Invalid auth key format."}

    helper = _helper_path()
    if helper is None:
        return {
            **get_status(),
            "state": "error",
            "error": (
                "The bundled Tailscale helper is missing. Rebuild the application "
                "with Go installed or set LEGKYI_TAILSCALE_HELPER."
            ),
        }

    try:
        set_autostart(autostart)
    except OSError as exc:
        return {**get_status(), "state": "error", "error": str(exc)}

    if _process is not None and _process.poll() is None:
        current = get_status()
        if current.get("state") == "running" or not supplied_key:
            return current
        # A supplied key retries a failed or unauthenticated attempt.
        _stop_child()

    root = _state_root()
    # The first poll must not reuse a previous helper's status or public URL.
    try:
        (root / "status.json").unlink(missing_ok=True)
    except OSError:
        pass

    env = os.environ.copy()
    env.pop("TS_AUTHKEY", None)
    env.pop("TS_AUTH_KEY", None)

    log_path = root / "helper.log"
    try:
        _log_handle = log_path.open("a", encoding="utf-8")
        _process = subprocess.Popen(
            [
                str(helper),
                "--state-dir",
                str(root / "identity"),
                "--status-file",
                str(root / "status.json"),
                "--target",
                f"http://127.0.0.1:{os.getenv('PORT', '8000')}",
                "--auth-key-stdin",
            ],
            stdin=subprocess.PIPE,
            stdout=_log_handle,
            stderr=subprocess.STDOUT,
            env=env,
            close_fds=True,
        )
        if _process.stdin is not None:
            _process.stdin.write((supplied_key + "\n").encode("utf-8"))
            _process.stdin.close()
    except (OSError, ValueError, BrokenPipeError) as exc:
        if _log_handle:
            _log_handle.close()
            _log_handle = None
        return {**get_status(), "state": "error", "error": f"Could not start helper: {exc}"}

    time.sleep(0.05)
    result = get_status()
    if result.get("state") == "disabled":
        result["state"] = "starting"
        result["enabled"] = True
    return result


def stop_funnel() -> dict[str, Any]:
    """Disconnect the helper but preserve the independent autostart preference."""
    _stop_child()
    try:
        (_state_root() / "status.json").unlink(missing_ok=True)
    except OSError:
        pass
    return get_status()


def _stop_child() -> None:
    """Stop the helper without changing the persisted opt-in setting."""
    global _process, _log_handle

    if _process is not None:
        if _process.poll() is None:
            _process.terminate()
            try:
                _process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _process.kill()
                _process.wait(timeout=5)
        _process = None
    if _log_handle:
        _log_handle.close()
        _log_handle = None


def start_if_enabled() -> dict[str, Any] | None:
    """Retry Funnel at app startup only if an administrator previously opted in."""
    if not _enabled_file().is_file():
        return None
    return start_funnel()


def shutdown() -> None:
    """Stop the child on orderly shutdown but preserve the administrator's opt-in."""
    _stop_child()
