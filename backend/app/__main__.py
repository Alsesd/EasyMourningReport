"""The single supported server entry point: ``python -m app``."""

import os
import sys
from pathlib import Path


def _load_env_file(env_path: Path | None = None) -> None:
    """Load the repository .env file without overriding explicitly exported values."""
    target = env_path if env_path is not None else Path(__file__).resolve().parents[2] / ".env"
    if not target.is_file():
        return
    try:
        for raw_line in target.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        # Environment-file loading is optional; explicit environment remains authoritative.
        return


_load_env_file()

# Set consistent encoding before importing modules that may log startup diagnostics.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uvicorn
from app.db.backup import BACKUP_DIR
from app.db.session import DB_PATH
from app.main import app


def print_startup_banner(host: str, port: int) -> None:
    """Print storage health and local endpoint details before the server starts."""
    data_dir = DB_PATH.parent
    storage_status = "OK (read/write)"
    for name, folder in (("Data", data_dir), ("Backups", BACKUP_DIR)):
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
            print(
                f"  [STORAGE WARNING] {name} directory '{folder}' may have restricted permissions: {exc}",
                flush=True,
            )

    banner = f"""
======================================================================
  EasyMourningReport / Легкий звіт
  Multi-Store Reporting & Analytics
======================================================================
  • Data Directory : {data_dir}
  • Backups Dir    : {BACKUP_DIR}
  • Database File  : {DB_PATH}
  • Storage Access : {storage_status}
  • Server Address : http://{host}:{port}
  • REST API       : http://{host}:{port}/api/v1
  • Web Interface  : http://{host}:{port}/
  • Platform       : {sys.platform} (Python {sys.version.split()[0]})
======================================================================
"""
    print(banner.strip(), flush=True)
    print(f"Data folder: {data_dir}", flush=True)


def main() -> None:
    """Start the production Uvicorn server."""
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    print_startup_banner(host, port)
    uvicorn.run(
        app,
        host=host,
        port=port,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()
