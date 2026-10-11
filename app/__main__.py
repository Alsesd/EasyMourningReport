"""Runtime entry point used by PyOxidizer's run_module configuration."""

import os

import uvicorn

from app.db import DB_PATH
from app.main import app

print(f"Data folder: {DB_PATH.parent}", flush=True)
uvicorn.run(
    app,
    host=os.getenv("HOST", "127.0.0.1"),
    port=int(os.getenv("PORT", "8000")),
)
