"""Application entry point used for source runs and the PyInstaller executable."""

import os

from app.db.session import DB_PATH
from app.launcher import server_start


def main() -> None:
    print(f"Data folder: {DB_PATH.parent}", flush=True)
    # Keep the packaged app local-only by default. Tailscale Funnel can expose it
    # explicitly when enabled by the launcher script.
    server_start(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
    )


if __name__ == "__main__":
    main()
