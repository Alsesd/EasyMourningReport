"""Runtime entry point used by PyOxidizer's run_module configuration."""

import os
import sys

import uvicorn

from app.db import DB_PATH
from app.main import app

1if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    
print(f"Data folder: {DB_PATH.parent}", flush=True)
uvicorn.run(
    app,
    host=os.getenv("HOST", "127.0.0.1"),
    port=int(os.getenv("PORT", "8000")),
)
