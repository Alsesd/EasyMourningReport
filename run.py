"""Source-tree launcher. Use `python run.py` or `poetry run python run.py."""

from app.db.session import DB_PATH
from app.launcher import server_start


def main() -> None:
    print(f"Data folder: {DB_PATH.parent}", flush=True)
    server_start()


if __name__ == "__main__":
    main()
