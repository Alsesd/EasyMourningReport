"""Security helpers: password hashing, secret-key persistence, and request checks."""

import hashlib
import hmac
import os
import secrets
from urllib.parse import urlparse

from fastapi import Request
from fastapi.responses import Response

from app.core.paths import data_dir


def hash_pw(pw: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    return (
        salt.hex()
        + "$"
        + hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000).hex()
    )


def check_pw(pw: str, stored: str) -> bool:
    return hmac.compare_digest(
        hash_pw(pw, bytes.fromhex(stored.split("$")[0])), stored
    )


def load_secret() -> str:
    if os.getenv("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = data_dir() / "secret.key"
    if not path.exists():
        path.write_text(secrets.token_hex(32))
        if os.name != "nt":
            try:
                path.chmod(0o600)
            except OSError:
                pass
    return path.read_text().strip()


async def same_origin_post_guard(request: Request, call_next):
    """Reject cross-origin or unverifiable browser mutations to prevent CSRF.

    Unsafe methods use the same-origin check because the REST API authenticates
    through the same session cookie as the HTML pages.
    """
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        source = request.headers.get("origin") or request.headers.get("referer")
        parsed = urlparse(source) if source else None
        if not parsed or parsed.scheme not in ("http", "https") or not parsed.netloc:
            return Response("Відхилено запит без перевірки джерела.", status_code=403)
        if parsed.netloc.lower() != request.headers.get("host", "").lower():
            return Response("Відхилено запит з іншого джерела.", status_code=403)
    return await call_next(request)


def client_ip(request: Request) -> str:
    host = request.client.host if request.client else "?"
    if host in ("127.0.0.1", "::1"):
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return host
