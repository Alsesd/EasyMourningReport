"""Security-related helpers shared by the FastAPI application.

This module is intentionally behavior-preserving: password hashing parameters,
secret-key persistence, client IP handling, and the same-origin POST guard are
kept unchanged while separated from route handlers.
"""

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
    path = data_dir() / "secret.key"  # generated once, kept next to the database/exe
    if not path.exists():
        path.write_text(secrets.token_hex(32))
    return path.read_text().strip()


async def same_origin_post_guard(request: Request, call_next):
    """Reject cross-origin or unverifiable browser POSTs to prevent CSRF.

    Browsers send Origin on form POSTs; Referer is accepted as a fallback for
    clients that omit Origin. Compare hosts rather than schemes because TLS
    may terminate at a trusted reverse proxy.
    """
    if request.method == "POST":
        source = request.headers.get("origin") or request.headers.get("referer")
        parsed = urlparse(source) if source else None
        if not parsed or parsed.scheme not in ("http", "https") or not parsed.netloc:
            return Response("Відхилено запит без перевірки джерела.", status_code=403)
        if parsed.netloc.lower() != request.headers.get("host", "").lower():
            return Response("Відхилено запит з іншого джерела.", status_code=403)
    return await call_next(request)


def client_ip(request: Request) -> str:
    host = request.client.host if request.client else "?"
    if host in ("127.0.0.1", "::1"):  # behind the local Funnel proxy: use the forwarded address if present
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return host
