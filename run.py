"""EasyMourningReport / Легкий звіт — Enterprise Application Entry Point.

Production entry point starting the FastAPI application with Uvicorn.
Provides cross-platform UTF-8 console output, enterprise startup diagnostics,
and reverse-proxy / tunnel header forwarding.
"""

import os
import sys

# Configure UTF-8 encoding across Linux and Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uvicorn
from app.db.backup import BACKUP_DIR
from app.db.session import DB_PATH
from app.main import app


def print_startup_banner(host: str, port: int) -> None:
    """Print an enterprise startup banner with system configuration."""
    data_dir = DB_PATH.parent
    banner = f"""
======================================================================
  EasyMourningReport / Легкий звіт (v1.0.0)
  Enterprise Multi-Store Reporting & Analytics System
======================================================================
  • Data Directory : {data_dir}
  • Backups Dir    : {BACKUP_DIR}
  • Database File  : {DB_PATH}
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
