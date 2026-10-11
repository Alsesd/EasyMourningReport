"""In-memory login throttling. Resets when the server restarts."""
import time
from collections import defaultdict, deque

WINDOW = 15 * 60  # seconds
LIMITS = {"pair": 5, "ip": 20, "login": 30}  # failures per window: ip+login, ip, login
_fails: dict[tuple, deque] = defaultdict(deque)


def _keys(ip: str, login: str):
    return [("pair", ip, login), ("ip", ip), ("login", login)]


def _recent(key: tuple) -> deque:
    q, cutoff = _fails[key], time.time() - WINDOW
    while q and q[0] < cutoff:
        q.popleft()
    return q


def retry_after(ip: str, login: str) -> int:
    """Seconds until the next attempt is allowed (0 = allowed now)."""
    wait = 0
    for key in _keys(ip, login):
        q = _recent(key)
        if len(q) >= LIMITS[key[0]]:
            wait = max(wait, int(q[0] + WINDOW - time.time()) + 1)
    return wait


def record_failure(ip: str, login: str) -> None:
    now = time.time()
    for key in _keys(ip, login):
        _fails[key].append(now)
    if len(_fails) > 5000:  # drop expired entries so random logins can't grow memory forever
        for key in list(_fails):
            if not _recent(key):
                del _fails[key]


def clear_failures(ip: str, login: str) -> None:
    _fails.pop(("pair", ip, login), None)
