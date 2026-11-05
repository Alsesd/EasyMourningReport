"""Public access through Cloudflare Tunnel, run by the application itself.

The app starts ``cloudflared`` as a child process and asks its local metrics endpoint how the
connection is doing. There is one mode of operation:

* with a token (``TUNNEL_TOKEN`` or one saved from the admin page) it runs your named tunnel,
  whose public hostname is configured in Cloudflare; set ``PUBLIC_URL`` to show it in the UI;
* without a token it opens a free Quick Tunnel and reports the random ``trycloudflare.com`` URL.

State lives in the data folder: ``tunnel/token`` (0600), ``tunnel/cloudflared.log`` and the
``.tunnel-enabled`` marker that restarts the tunnel with the app.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import urllib.request
from pathlib import Path
from typing import Any, TextIO

from app.core.paths import data_dir

METRICS = "127.0.0.1:20241"
_lock = threading.Lock()
_process: subprocess.Popen | None = None
_log: TextIO | None = None


def _root(root: Path | None) -> Path:
    return root or data_dir()


def _state_dir(root: Path | None = None) -> Path:
    folder = _root(root) / "tunnel"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _marker(root: Path | None = None) -> Path:
    base = _root(root)
    marker = base / ".tunnel-enabled"
    legacy = base / ".tailscale-funnel-enabled"  # written by releases that also offered Tailscale
    if legacy.is_file():
        if not marker.exists():
            legacy.replace(marker)
        else:
            legacy.unlink(missing_ok=True)
    return marker


def _token_file(root: Path | None = None) -> Path:
    return _state_dir(root) / "token"


def _saved_token(root: Path | None = None) -> str:
    try:
        return _token_file(root).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _token(root: Path | None = None) -> str:
    return os.getenv("TUNNEL_TOKEN", "").strip() or _saved_token(root)


def _save_token(token: str, root: Path | None = None) -> None:
    path = _token_file(root)
    path.write_text(token, encoding="utf-8")
    if os.name != "nt":
        path.chmod(0o600)


def _cloudflared() -> str | None:
    override = os.getenv("CLOUDFLARED_PATH", "").strip()
    if override:
        return override if Path(override).is_file() else None
    return shutil.which("cloudflared")


def _metrics(path: str) -> dict[str, Any] | None:
    try:
        with urllib.request.urlopen(f"http://{METRICS}{path}", timeout=0.5) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except (OSError, ValueError):
        return None


def _last_log_line(root: Path | None = None) -> str:
    try:
        lines = (_state_dir(root) / "cloudflared.log").read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    meaningful = [line.strip() for line in lines if "ERR" in line or "error" in line.lower()]
    return (meaningful or [line.strip() for line in lines if line.strip()] or [""])[-1][-300:]


def status(root: Path | None = None) -> dict[str, Any]:
    """``state`` is one of disabled, stopped, starting, running, error."""
    autostart = _marker(root).is_file()
    result: dict[str, Any] = {
        "enabled": False,
        "autostart": autostart,
        "has_token": bool(_token(root)),
        "state": "stopped" if autostart else "disabled",
        "public_url": "",
        "error": "",
    }
    if _process is None:
        return result
    code = _process.poll()
    if code is not None:
        result.update(state="error", error=_last_log_line(root) or f"cloudflared завершився з кодом {code}.")
        return result

    result["enabled"] = True
    ready = _metrics("/ready") or {}
    result["state"] = "running" if ready.get("readyConnections", 0) > 0 else "starting"
    quick = _metrics("/quicktunnel") or {}
    if quick.get("hostname"):
        result["public_url"] = f"https://{quick['hostname']}"
    elif result["state"] == "running":
        result["public_url"] = os.getenv("PUBLIC_URL", "").strip()
    return result


def set_autostart(enabled: bool, root: Path | None = None) -> dict[str, Any]:
    marker = _marker(root)
    if enabled:
        marker.write_text("enabled\n", encoding="utf-8")
    else:
        marker.unlink(missing_ok=True)
    return status(root)


def start(token: str | None = None, autostart: bool = True, root: Path | None = None) -> dict[str, Any]:
    """Start cloudflared (restarting it when a new token is given)."""
    global _process, _log
    supplied = (token or "").strip()
    if any(ch.isspace() for ch in supplied):
        return {**status(root), "state": "error", "error": "Токен тунелю не може містити пробілів чи переносів рядка."}
    with _lock:
        if supplied:
            _save_token(supplied, root)
        set_autostart(autostart, root)
        if _process is not None and _process.poll() is None:
            if not supplied:
                return status(root)
            _stop_process()

        binary = _cloudflared()
        if binary is None:
            return {**status(root), "state": "error", "error": "cloudflared не встановлено на цьому сервері."}
        run_token = _token(root)
        command = [binary, "tunnel", "--no-autoupdate", "--metrics", METRICS]
        if run_token:
            command += ["run", "--token", run_token]
        else:
            command += ["--url", f"http://127.0.0.1:{os.getenv('PORT', '8000')}"]
        _log = (_state_dir(root) / "cloudflared.log").open("w", encoding="utf-8")
        try:
            _process = subprocess.Popen(command, stdout=_log, stderr=subprocess.STDOUT)
        except OSError as exc:
            _close_log()
            return {**status(root), "state": "error", "error": f"Не вдалося запустити cloudflared: {exc}"}
    return status(root)


def stop(root: Path | None = None) -> dict[str, Any]:
    """Disconnect now; the autostart preference is left as it is."""
    with _lock:
        _stop_process()
    return status(root)


def start_if_enabled(root: Path | None = None) -> dict[str, Any] | None:
    """At startup: ``TUNNEL_ENABLED=0`` wins, then ``TUNNEL_ENABLED=1`` / ``TUNNEL_TOKEN``, then the saved preference."""
    flag = os.getenv("TUNNEL_ENABLED", "").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        return None
    if flag in {"1", "true", "yes", "on"} or os.getenv("TUNNEL_TOKEN", "").strip() or _marker(root).is_file():
        return start(autostart=True, root=root)
    return None


def shutdown() -> None:
    with _lock:
        _stop_process()


def _stop_process() -> None:
    global _process
    if _process is not None and _process.poll() is None:
        _process.terminate()
        try:
            _process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _process.kill()
            _process.wait(timeout=5)
    _process = None
    _close_log()


def _close_log() -> None:
    global _log
    if _log is not None:
        try:
            _log.close()
        except OSError:
            pass
        _log = None
