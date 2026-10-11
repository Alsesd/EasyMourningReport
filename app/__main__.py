"""Runtime entry point used by PyOxidizer's run_module configuration."""

import os
import sys

# PyOxidizer's Windows console can default to a legacy code page such as cp1252.
# Startup logs contain Ukrainian text, so configure both streams before importing
# the app (the lifespan seeds and prints the initial admin credentials).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

import uvicorn

from app.db import DB_PATH
from app.main import app

print(f"Data folder: {DB_PATH.parent}", flush=True)
uvicorn.run(
    app,
    host=os.getenv("HOST", "127.0.0.1"),
    port=int(os.getenv("PORT", "8000")),
)
