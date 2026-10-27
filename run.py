"""EasyMourningReport / Легкий звіт — Enterprise Application Entry Point.

Production entry point starting the FastAPI application with Uvicorn.
Provides cross-platform UTF-8 console output, enterprise startup diagnostics,
and reverse-proxy / tunnel header forwarding.
"""

import os
import sys
from pathlib import Path

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")


def _load_env_file(env_path: Path | None = None) -> None:
    """Load default .env configuration if present and variables are not already set."""
    target = env_path if env_path is not None else Path(__file__).resolve().parent / ".env"
    if not target.is_file():
        return
    try:
        for line in target.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        pass


_load_env_file()

# Configure UTF-8 encoding across Linux and Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uvicorn
from app.core.backup import BACKUP_DIR
from app.core.database import DATABASE_URL
from app.core.paths import data_dir as get_data_dir
from app.main import app


def print_startup_banner(host: str, port: int) -> None:
    """Print an enterprise startup banner with system configuration."""
    data_dir = get_data_dir()
    storage_status = "OK (read/write)"
    for name, folder in [("Data", data_dir), ("Backups", BACKUP_DIR)]:
        try:
            folder.mkdir(parents=True, exist_ok=True)
            probe = folder / f".probe_{os.getpid()}"
            probe.write_text("ok", encoding="utf-8")
            try:
                probe.unlink(missing_ok=True)
            except OSError:
                pass
        except OSError as exc:
            storage_status = "WARNING (restricted permissions)"
            print(f"  [STORAGE WARNING] {name} directory '{folder}' may have restricted permissions: {exc}", flush=True)

    banner = f"""
======================================================================
  EasyMourningReport / Легкий звіт (v1.0.0)
  Enterprise Multi-Store Reporting & Analytics System
======================================================================
  • Data Directory : {data_dir}
  • Backups Dir    : {BACKUP_DIR}
  • Database URL   : {DATABASE_URL}
  • Storage Access : {storage_status}
  • Server Address : http://{host}:{port}
  • REST API       : http://{host}:{port}/api/v1
  • Web Interface  : http://{host}:{port}/
  • Platform       : {sys.platform} (Python {sys.version.split()[0]})
======================================================================
"""
    print(banner.strip(), flush=True)
    # Required for backwards-compatibility with automated tests verifying data path
    print(f"Data folder: {data_dir}", flush=True)


def server_start(
    host: str | None = None,
    port: int | None = None,
) -> None:
    """Start Uvicorn production server with proxy headers enabled."""
    resolved_host = host if host is not None else os.getenv("HOST", "0.0.0.0")
    resolved_port = port if port is not None else int(os.getenv("PORT", "8000"))
    print_startup_banner(resolved_host, resolved_port)
    uvicorn.run(
        app,
        host=resolved_host,
        port=resolved_port,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


def main() -> None:
    server_start()


if __name__ == "__main__":
    main()
