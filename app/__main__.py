"""Runtime entry point used by PyOxidizer's run_module configuration."""

import os
import sys

# CPython TextIOWrapper supports reconfigure; PyOxidizer's Windows console can
# otherwise default to cp1252 and crash when startup prints Ukrainian text.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uvicorn

from app.db.session import DB_PATH
from app.main import app

print(f"Data folder: {DB_PATH.parent}", flush=True)
uvicorn.run(
    app,
    host=os.getenv("HOST", "127.0.0.1"),
    port=int(os.getenv("PORT", "8000")),
)
