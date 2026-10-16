"""Lifecycle and persistent opt-in for the app-specific Tailscale helper.

Auth keys are passed to the helper over stdin only; they are never written to
disk, included in command-line arguments, or placed in the child environment.
On Windows, the bundled helper is installed at a deterministic per-user path
so firewall identity and Defender reputation are not tied to PyInstaller's
temporary one-file extraction directory.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from app.core.paths import user_data_dir

_process: subprocess.Popen | None = None
_log_handle = None
_HELPER_NAME = "tailscale-helper.exe"
_HELPER_HASH_NAME = "tailscale-helper.sha256"


def _state_root() -> Path:
    path = user_data_dir() / "tailscale"
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        path.chmod(0o700)
    return path


def _enabled_file() -> Path:
    return user_data_dir() / ".tailscale-funnel-enabled"


def _install_windows_helper(source: Path) -> Path | None:
    """Copy the bundled helper to a stable per-user path when its hash changes.

    The digest detects version changes; it is not a substitute for Authenticode
    signature verification. Release builds should sign the helper before
    bundling it. If an old helper is locked by a running process, keep that
    executable and retry the upgrade after the application restarts.
    """
    directory = user_data_dir() / "bin"
    destination = directory / _HELPER_NAME
    hash_file = directory / _HELPER_HASH_NAME

    try:
        directory.mkdir(parents=True, exist_ok=True)
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

        if destination.is_file():
            try:
                recorded_hash = hash_file.read_text(encoding="ascii").strip()
                installed_hash = hashlib.sha256(destination.read_bytes()).hexdigest()
                if recorded_hash == source_hash == installed_hash:
                    return destination
            except OSError:
                pass

        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=".tailscale-helper-",
                suffix=".tmp",
                dir=directory,
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                with source.open("rb") as source_file:
                    shutil.copyfileobj(source_file, temporary)
                temporary.flush()
                os.fsync(temporary.fileno())

            # os.replace is atomic on the same volume. Windows may reject it
            # while the old helper is running; in that case keep the old copy.
            os.replace(temporary_path, destination)
            temporary_path = None

            hash_tmp = hash_file.with_suffix(".tmp")
            hash_tmp.write_text(source_hash + "\n", encoding="ascii")
            os.replace(hash_tmp, hash_file)
            return destination
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
    except OSError:
        # A locked destination can still be used for this run if it exists.
        return destination if destination.is_file() else None


def _helper_path() -> Path | None:
    override = os.getenv("LEGKYI_TAILSCALE_HELPER")
    if override:
        candidate = Path(override).expanduser()
        return candidate.resolve() if candidate.is_file() else None

    executable_name = _HELPER_NAME if os.name == "nt" else "tailscale-helper"
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
            if os.name == "nt":
                # Avoid executing the copy extracted into a random _MEIPASS.
                return _install_windows_helper(candidate)
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
        if result["state"] in ("disabled", "stopped", "enabled-but-not-running"):
            result.update(state="starting", public_url="", login_url="", error="")
        result["enabled"] = True
    elif _process is not None:
        if result["error"]:
            result.update(state="error", public_url="", login_url="")
        elif autostart:
            result.update(state="stopped", public_url="", login_url="")
        else:
            result.update(state="disabled", enabled=False, public_url="", login_url="", error="")
    elif autostart:
        if result["state"] != "error":
            result.update(state="enabled-but-not-running", public_url="", login_url="")
        result["enabled"] = True
    else:
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
        _stop_child()

    root = _state_root()
    try:
        (root / "status.json").unlink(missing_ok=True)
    except OSError:
        pass

    env = os.environ.copy()
    env.pop("TS_AUTHKEY", None)
    env.pop("TS_AUTH_KEY", None)

    startupinfo = None
    creationflags = 0
    if sys.platform == "win32":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        creationflags = subprocess.CREATE_NO_WINDOW

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
            startupinfo=startupinfo,
            creationflags=creationflags,
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
