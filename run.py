"""Application entry point."""

import os
from app.db.session import DB_PATH
from app.launcher import server_start


def main() -> None:
    print(f"Data folder: {DB_PATH.parent}", flush=True)

    # In Docker, 0.0.0.0 binds to all container interfaces.
    # Cloudflare Tunnel connects via the shared network stack.
    server_start(
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
    )


if __name__ == "__main__":
    main()
