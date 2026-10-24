"""Tunnel lifecycle and status management for headless Docker containers and local runtimes.

In Docker mode, the tunnel runs as a sidecar container (e.g. Cloudflare Tunnel
in compose.yaml) which updates status in the shared data directory. In standalone
mode (e.g. local Python execution or single container), it manages the cloudflared
process directly if installed.
"""

import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.paths import user_data_dir

_process: subprocess.Popen | None = None
_log_handle: Any = None


def _state_root(root: Path | None = None) -> Path:
    base = root or user_data_dir()
    path = base / "tunnel"
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        try:
            path.chmod(0o700)
        except OSError:
            pass
    return path


def _enabled_file(root: Path | None = None) -> Path:
    base = root or user_data_dir()
    tunnel_file = base / ".tunnel-enabled"
    if tunnel_file.is_file():
        return tunnel_file
    legacy_file = base / ".tailscale-funnel-enabled"
    if legacy_file.is_file():
        return legacy_file
    return tunnel_file


def _is_sidecar_active(root: Path | None = None) -> bool:
    sidecar_marker = _state_root(root) / ".sidecar"
    if not sidecar_marker.is_file():
        return False
    try:
        mtime = sidecar_marker.stat().st_mtime
        return (time.time() - mtime) < 60
    except OSError:
        return False


def _cloudflared_path() -> Path | None:
    override = os.getenv("CLOUDFLARED_PATH")
    if override:
        path = Path(override)
        if path.is_file():
            return path
    which = shutil.which("cloudflared")
    if which:
        return Path(which)
    return None


def get_status(root: Path | None = None) -> dict[str, Any]:
    """Report tunnel state based on running process, sidecar state, or saved status."""
    global _process

    base = root or user_data_dir()
    autostart = (base / ".tunnel-enabled").is_file() or (base / ".tailscale-funnel-enabled").is_file()
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

    # Inspect status files from tunnel state root first, then fallback to tailscale directory
    status_paths = [
        _state_root(root) / "status.json",
        base / "tailscale" / "status.json",
    ]
    stored = None
    for p in status_paths:
        try:
            if p.is_file():
                stored = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(stored, dict):
                    break
        except (OSError, ValueError):
            pass

    if isinstance(stored, dict):
        for key in ("state", "public_url", "login_url", "error", "updated_at"):
            if isinstance(stored.get(key), str):
                result[key] = stored[key]

    # If standalone process is running, inspect log file for TryCloudflare URL if not yet captured
    if process_running and not result.get("public_url"):
        log_file = _state_root(root) / "cloudflared.log"
        if log_file.is_file():
            try:
                content = log_file.read_text(encoding="utf-8", errors="replace")
                match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", content)
                if match:
                    result["public_url"] = match.group(0)
                    result["state"] = "running"
            except OSError:
                pass

    # A live process takes precedence
    if process_running:
        if result["state"] in ("disabled", "stopped", "enabled-but-not-running"):
            result.update(state="starting" if not result.get("public_url") else "running")
    elif _process is not None:
        if autostart and not result.get("error"):
            result.update(state="stopped", public_url="", login_url="")
        elif not autostart:
            result.update(state="disabled", public_url="", login_url="", error="")
    elif not autostart and not _is_sidecar_active(root):
        env_pub = os.getenv("PUBLIC_URL") or os.getenv("TUNNEL_URL")
        if not env_pub:
            result.update(state="disabled", public_url="", login_url="", error="")

    # Support explicit public URL override via environment
    env_public_url = os.getenv("PUBLIC_URL") or os.getenv("TUNNEL_URL")
    if env_public_url and not result.get("public_url"):
        result["public_url"] = env_public_url
        if result.get("state") in ("disabled", "enabled-but-not-running"):
            result["state"] = "running"

    return result


def set_autostart(enabled: bool, root: Path | None = None) -> dict[str, Any]:
    """Set the startup preference without changing the running tunnel."""
    base = root or user_data_dir()
    marker = base / ".tunnel-enabled"
    legacy_marker = base / ".tailscale-funnel-enabled"
    try:
        if enabled:
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text("enabled\n", encoding="utf-8")
            legacy_marker.write_text("enabled\n", encoding="utf-8")
            if os.name != "nt":
                try:
                    marker.chmod(0o600)
                    legacy_marker.chmod(0o600)
                except OSError:
                    pass
        else:
            marker.unlink(missing_ok=True)
            legacy_marker.unlink(missing_ok=True)
    except OSError as exc:
        raise OSError(f"Could not update tunnel autostart: {exc}") from exc
    return get_status(root)


def start_tunnel(
    auth_key: str | None = None,
    autostart: bool = True,
    root: Path | None = None,
) -> dict[str, Any]:
    """Start the tunnel (via active sidecar container or standalone cloudflared process)."""
    global _process, _log_handle

    supplied_key = (auth_key or "").strip()
    if "\n" in supplied_key or "\r" in supplied_key:
        return {**get_status(root), "state": "error", "error": "Invalid auth key format."}

    try:
        set_autostart(autostart, root=root)
    except OSError as exc:
        return {**get_status(root), "state": "error", "error": str(exc)}

    # If sidecar container is active, communicate via control files
    if _is_sidecar_active(root):
        state_dir = _state_root(root)
        try:
            (state_dir / ".stop").unlink(missing_ok=True)
            if supplied_key:
                token_file = state_dir / "token"
                token_file.write_text(supplied_key, encoding="utf-8")
                if os.name != "nt":
                    try:
                        token_file.chmod(0o600)
                    except OSError:
                        pass
            else:
                (state_dir / "token").unlink(missing_ok=True)
            (state_dir / ".start").touch()
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            status_data = {
                "state": "starting",
                "public_url": "",
                "login_url": "",
                "error": "",
                "updated_at": now,
            }
            (state_dir / "status.json").write_text(json.dumps(status_data), encoding="utf-8")
        except OSError:
            pass
        return get_status(root)

    # Standalone mode: manage cloudflared directly
    if _process is not None and _process.poll() is None:
        current = get_status(root)
        if current.get("state") == "running" or not supplied_key:
            return current
        _stop_child(root)

    cf = _cloudflared_path()
    if cf is None:
        env_pub = os.getenv("PUBLIC_URL") or os.getenv("TUNNEL_URL")
        if env_pub:
            return {**get_status(root), "state": "running", "public_url": env_pub}
        return {
            **get_status(root),
            "state": "error",
            "error": "cloudflared is not installed. Install cloudflared, run via Docker Compose, or configure PUBLIC_URL.",
        }

    state_dir = _state_root(root)
    token = supplied_key or os.getenv("TUNNEL_TOKEN") or os.getenv("CLOUDFLARE_TUNNEL_TOKEN") or ""
    token = token.strip()

    if token:
        cmd = [str(cf), "tunnel", "--no-autoupdate", "run", "--token", token]
    else:
        port = os.getenv("PORT", "8000")
        target = f"http://127.0.0.1:{port}"
        cmd = [str(cf), "tunnel", "--no-autoupdate", "--url", target]

    log_path = state_dir / "cloudflared.log"
    try:
        _log_handle = log_path.open("w+", encoding="utf-8")
        _process = subprocess.Popen(
            cmd,
            stdout=_log_handle,
            stderr=subprocess.STDOUT,
            close_fds=True,
        )
    except (OSError, ValueError) as exc:
        if _log_handle:
            try:
                _log_handle.close()
            except OSError:
                pass
            _log_handle = None
        return {**get_status(root), "state": "error", "error": f"Could not start cloudflared: {exc}"}

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    status_data = {
        "state": "starting",
        "public_url": "",
        "login_url": "",
        "error": "",
        "updated_at": now,
    }
    try:
        (state_dir / "status.json").write_text(json.dumps(status_data), encoding="utf-8")
    except OSError:
        pass

    time.sleep(0.05)
    return get_status(root)


def stop_tunnel(root: Path | None = None) -> dict[str, Any]:
    """Stop the tunnel (via active sidecar or child process) and clear active state."""
    state_dir = _state_root(root)
    base = root or user_data_dir()

    if _is_sidecar_active(root):
        try:
            (state_dir / ".stop").touch()
            (state_dir / ".start").unlink(missing_ok=True)
            (state_dir / "token").unlink(missing_ok=True)
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            status_data = {
                "state": "stopped",
                "public_url": "",
                "login_url": "",
                "error": "",
                "updated_at": now,
            }
            (state_dir / "status.json").write_text(json.dumps(status_data), encoding="utf-8")
        except OSError:
            pass
        return get_status(root)

    _stop_child(root)

    for p in [state_dir / "status.json", base / "tailscale" / "status.json"]:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass

    return get_status(root)


def _stop_child(root: Path | None = None) -> None:
    """Stop the standalone helper process without changing persistent setting."""
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
    if _log_handle is not None:
        try:
            _log_handle.close()
        except OSError:
            pass
        _log_handle = None


def start_if_enabled(root: Path | None = None) -> dict[str, Any] | None:
    """Start tunnel at app startup only if administrator previously opted in."""
    if not _enabled_file(root).is_file():
        return None
    return start_tunnel(root=root)


def shutdown() -> None:
    """Stop child process on orderly application shutdown."""
    _stop_child()


# Aliases for backward compatibility
start_funnel = start_tunnel
stop_funnel = stop_tunnel
