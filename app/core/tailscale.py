"""Lifecycle and persistent opt-in for the app-specific Tailscale helper.

Auth keys are passed to the helper over stdin only; they are never written to
disk, included in command-line arguments, or placed in the child environment.
A public Funnel is attempted at startup only after an administrator has opted in.
"""

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from app.core.paths import user_data_dir

_process: subprocess.Popen | None = None
_log_handle = None
_helper_build_error = ""


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
        Path(__file__).resolve().parents[2] / "tailscale-helper",
        Path(__file__).resolve().parents[2] / "tailscale-helper" / "bin",
        Path(__file__).resolve().parents[2] / "build",
    ]
    for root in roots:
        candidate = root / executable_name
        if candidate.is_file():
            return candidate

    # Reuse a previously built source-mode helper across application restarts.
    global _helper_build_error
    destination_dir = user_data_dir() / "tailscale" / "bin"
    destination = destination_dir / executable_name
    if destination.is_file():
        return destination

    # Source checkouts do not contain compiled helper binaries. Build it lazily
    # into the user's private data directory so running from source works too,
    # without dirtying the checkout or requiring a manual build step.
    source_dir = Path(__file__).resolve().parents[2] / "tailscale-helper"
    if not getattr(sys, "frozen", False) and (source_dir / "go.mod").is_file():
        go = shutil.which("go")
        if not go:
            _helper_build_error = (
                "Go 1.24+ is required to build the Tailscale helper from source. "
                "Install Go or enter the project's Nix development shell, then retry."
            )
            return None
        try:
            destination_dir.mkdir(parents=True, exist_ok=True)
            build = subprocess.run(
                [go, "build", "-trimpath", "-ldflags", "-s -w", "-o", str(destination), "."],
                cwd=source_dir,
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
            )
            if build.returncode == 0 and destination.is_file():
                if os.name != "nt":
                    destination.chmod(0o700)
                _helper_build_error = ""
                return destination
            details = (build.stderr or build.stdout or "go build returned no diagnostic").strip()
            _helper_build_error = f"Could not build the Tailscale helper: {details[-1200:]}"
        except (OSError, subprocess.SubprocessError) as exc:
            _helper_build_error = f"Could not build the Tailscale helper: {exc}"
    return None


def get_status() -> dict[str, Any]:
    """Report helper runtime state separately from the persistent autostart preference."""
    autostart = _enabled_file().is_file()
    process_running = _process is not None and _process.poll() is None
    enabled = autostart or process_running
    result: dict[str, Any] = {
        "enabled": enabled,
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

    # A live helper process takes precedence over stale status left by a previous
    # process. Its next status-file write will refine "starting" to running/auth.
    if process_running:
        if result["state"] in ("disabled", "stopped", "enabled-but-not-running"):
            result.update(state="starting", public_url="", login_url="", error="")
    elif _process is not None:
        if autostart and not result["error"]:
            result.update(state="stopped", public_url="", login_url="")
        elif not autostart:
            result.update(state="disabled", public_url="", login_url="", error="")
    elif autostart:
        # A persisted startup preference is not proof the Funnel is connected.
        if result["state"] in ("running", "starting", "authentication-required", "stopped", "disabled"):
            result.update(state="enabled-but-not-running", public_url="", login_url="")
    else:
        # With no process and no autostart preference, saved status is stale.
        result.update(state="disabled", public_url="", login_url="", error="")
    return result


def set_autostart(enabled: bool) -> dict[str, Any]:
    """Set the startup preference without connecting or disconnecting the running helper."""
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
        return {**get_status(), "state": "error", "error": f"Could not update Tailscale autostart: {exc}"}
    return get_status()


def start_funnel(auth_key: str | None = None, autostart: bool = True) -> dict[str, Any]:
    """Start the bundled helper and apply the desired autostart preference."""
    global _process, _log_handle

    supplied_key = (auth_key or "").strip()
    if "\n" in supplied_key or "\r" in supplied_key:
        return {**get_status(), "state": "error", "error": "Invalid auth key format."}

    helper = _helper_path()
    if helper is None:
        return {
            **get_status(),
            "state": "error",
            "error": _helper_build_error or (
                "The Tailscale helper is missing. Install Go 1.24+ and retry, "
                "or set LEGKYI_TAILSCALE_HELPER to an existing helper binary."
            ),
        }

    # Keep the startup preference independent from whether the helper is running now.
    preference = set_autostart(autostart)
    if preference.get("error"):
        return preference

    if _process is not None and _process.poll() is None:
        current = get_status()
        if current.get("state") == "running" or not supplied_key:
            return current
        # A key was supplied to retry a failed/unauthenticated attempt.
        _stop_child()

    root = _state_root()
    # Do not let the first poll reuse a previous helper's "running" snapshot.
    try:
        (root / "status.json").unlink(missing_ok=True)
    except OSError:
        pass

    env = os.environ.copy()
    # Prevent inherited auth keys from being exposed in the child environment.
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

    # The helper writes its detailed state asynchronously. Do not claim that
    # Funnel is live before it has actually acquired the public listener.
    time.sleep(0.05)
    return get_status()


def stop_funnel() -> dict[str, Any]:
    """Disable public exposure and clear the persistent opt-in."""
    global _process, _log_handle

    _stop_child()
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
    return start_funnel(autostart=True)


def shutdown() -> None:
    """Stop the child on orderly shutdown but preserve the administrator's opt-in."""
    _stop_child()
