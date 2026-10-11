"""PyOxidizer module entry point.
from app.launcher import server_start

Keep this module deliberately tiny: importing the package and resolving data
paths is the application's responsibility, not the entry point's.
"""

from app.launcher import server_start


if __name__ == "__main__":
    server_start()
