"""Name and login normalisation shared by the platform and modules (pure functions)."""

import re

LOGIN_RE = re.compile(r"\S{2,40}")


def norm_login(raw: str) -> str:
    """Logins are case-insensitive and trimmed: 'Store1 ' and 'store1' are the same login."""
    return (raw or "").strip().lower()


def valid_login(login: str) -> bool:
    return bool(LOGIN_RE.fullmatch(login))


def norm_name(raw: str) -> str:
    return " ".join((raw or "").split())


def same_name(a: str, b: str) -> bool:
    return norm_name(a).casefold() == norm_name(b).casefold()


def dedupe_logins(logins: list[tuple[int, str]]) -> dict[int, str]:
    """Migration helper: map user id -> normalised login, making colliding ones unique with a suffix."""
    out: dict[int, str] = {}
    taken: set[str] = set()
    for uid, raw in sorted(logins):
        new = norm_login(raw) or f"user{uid}"
        if new in taken:
            new = f"{new}-{uid}"
        taken.add(new)
        out[uid] = new
    return out
