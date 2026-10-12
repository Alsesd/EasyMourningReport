"""Launcher shared by source and packaged entry points."""

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uvicorn

from app.main import app


def server_start(
    host: str | None = None,
    port: int | None = None,
) -> None:
    """Start the local web server; environment variables can override defaults."""
    resolved_host = host or os.getenv("HOST", "127.0.0.1")
    resolved_port = port if port is not None else int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host=resolved_host, port=resolved_port)
