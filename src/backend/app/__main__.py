"""Production entry point: `python -m app`."""

import os
import sys

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from app.core.env import load_env_file

load_env_file()

import uvicorn

from app.core.startup import print_startup_banner
from app.main import app


def main() -> None:
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
