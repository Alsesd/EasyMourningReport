"""Smoke-test a frozen Windows build without touching a user's real data."""

from __future__ import annotations

import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def fetch(url: str, timeout: float = 3.0) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "LegkyiZvit-SmokeTest"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def start(exe: Path, data_dir: Path, port: int) -> subprocess.Popen:
    env = os.environ.copy()
    env.update(
        LEGKYI_DATA_DIR=str(data_dir),
        LEGKYI_BACKUPS_DIR=str(data_dir / "backups"),
        HOST="127.0.0.1",
        PORT=str(port),
        TUNNEL_ENABLED="0",
        BACKUP_SIDECAR_ENABLED="0",
    )
    return subprocess.Popen(
        [str(exe)],
        cwd=str(exe.parent),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def wait_for_server(process: subprocess.Popen, base_url: str) -> None:
    deadline = time.monotonic() + 45
    last_error = "server did not respond"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"Executable exited with {process.returncode}. Output:\n{output}")
        try:
            status, body = fetch(base_url, timeout=1.0)
            if status == 200 and body:
                return
            last_error = f"unexpected root response: HTTP {status}"
        except (OSError, TimeoutError) as exc:
            last_error = str(exc)
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for executable at {base_url}: {last_error}")


def stop(process: subprocess.Popen) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def verify_run(exe: Path, data_dir: Path, port: int) -> None:
    process = start(exe, data_dir, port)
    try:
        base = f"http://127.0.0.1:{port}"
        wait_for_server(process, base)

        status, index = fetch(base + "/static/app/index.html")
        if status != 200 or b"<html" not in index.lower():
            raise RuntimeError(f"Built frontend did not load: HTTP {status}")

        # Confirm the frontend's referenced local JS/CSS assets are actually served.
        refs = re.findall(rb'''(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']''', index)
        local_refs = [
            ref.decode("utf-8")
            for ref in refs
            if not ref.startswith((b"http://", b"https://", b"//", b"data:"))
        ]
        if not local_refs:
            raise RuntimeError("Built frontend index contains no local JavaScript/CSS assets.")
        for ref in local_refs[:8]:
            path = ref if ref.startswith("/") else "/static/app/" + ref
            asset_status, _ = fetch(base + path)
            if asset_status != 200:
                raise RuntimeError(f"Frontend asset failed: {path} returned HTTP {asset_status}")

        # API prefix should resolve to an application response, not a missing executable import.
        api_status, _ = fetch(base + "/api/v1")
        if api_status >= 500:
            raise RuntimeError(f"API smoke check failed: HTTP {api_status}")
    finally:
        stop(process)


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/smoke_test_windows_exe.py path/to/LegkyiZvit.exe")
        return 2

    exe = Path(sys.argv[1]).resolve()
    if not exe.is_file():
        raise FileNotFoundError(exe)

    with tempfile.TemporaryDirectory(prefix="legkyizvit-exe-smoke-") as temp:
        data_dir = Path(temp) / "app_storage" / "data"
        data_dir.mkdir(parents=True)
        port = free_port()

        verify_run(exe, data_dir, port)
        db_path = data_dir / "reports.db"
        secret_path = data_dir / "secret.key"
        if not db_path.is_file():
            raise RuntimeError("Application did not create persistent SQLite database.")
        if not secret_path.is_file():
            raise RuntimeError("Application did not create persistent session secret.")
        first_db_size = db_path.stat().st_size
        first_secret = secret_path.read_bytes()

        # Restart against exactly the same storage directory to catch first-run-only success.
        verify_run(exe, data_dir, port)
        if not db_path.is_file() or db_path.stat().st_size < first_db_size:
            raise RuntimeError("SQLite database did not survive application restart.")
        if secret_path.read_bytes() != first_secret:
            raise RuntimeError("Session secret changed across restart; existing sessions would be invalidated.")

    print("PASS: frozen EXE starts, serves the SPA and assets, responds to API probe, and preserves SQLite/secret storage across restart.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
