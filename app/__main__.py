"""Runtime entry point used by PyOxidizer, frozen executables, and python -m app."""

import os
import sys

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

# Configure UTF-8 encoding across Linux and Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uvicorn

from app.core.paths import data_dir as get_data_dir
from app.main import app

data_dir = get_data_dir()
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
