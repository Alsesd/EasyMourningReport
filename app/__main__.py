"""Runtime entry point used by PyOxidizer, frozen executables, and python -m app."""

import os
import sys

# Configure UTF-8 encoding across Linux and Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uvicorn
from app.db.session import DB_PATH
from app.main import app

data_dir = DB_PATH.parent
host = os.getenv("HOST", "127.0.0.1")
port = int(os.getenv("PORT", "8000"))

from run import print_startup_banner
print_startup_banner(host, port)

uvicorn.run(
    app,
    host=host,
    port=port,
    proxy_headers=True,
    forwarded_allow_ips="*",
)
