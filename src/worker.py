"""Cloudflare Python Worker entry point for EasyMourningReport."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import quote_plus

# In the generated Cloudflare bundle, app/ and src/ are sibling directories.
_BUNDLE_ROOT = str(Path(__file__).resolve().parents[1])
if _BUNDLE_ROOT not in sys.path:
    sys.path.insert(0, _BUNDLE_ROOT)

from workers import env

# Copy bindings before importing modules that initialize SQLAlchemy/session state.
for _name in ("DATABASE_URL", "SECRET_KEY", "ADMIN_PASSWORD"):
    try:
        _value = getattr(env, _name)
    except (AttributeError, TypeError):
        _value = None
    if _value:
        os.environ[_name] = str(_value)

# Hyperdrive is optional. When configured, it provides pooled PostgreSQL
# connectivity; otherwise the deployment must supply DATABASE_URL as a secret.
if not os.environ.get("DATABASE_URL"):
    try:
        _hyperdrive = getattr(env, "HYPERDRIVE")
    except (AttributeError, TypeError):
        _hyperdrive = None
    if _hyperdrive is not None:
        _user = quote_plus(str(_hyperdrive.user))
        _password = quote_plus(str(_hyperdrive.password))
        _host = str(_hyperdrive.host)
        _port = int(_hyperdrive.port)
        _database = quote_plus(str(_hyperdrive.database))
        os.environ["DATABASE_URL"] = (
            f"postgresql+pg8000://{_user}:{_password}@{_host}:{_port}/{_database}"
        )

if not os.environ.get("DATABASE_URL"):
    raise RuntimeError("Set the DATABASE_URL secret or configure a HYPERDRIVE binding.")
if not os.environ.get("SECRET_KEY"):
    raise RuntimeError("Set the SECRET_KEY Worker secret.")
if not os.environ.get("ADMIN_PASSWORD"):
    raise RuntimeError("Set the ADMIN_PASSWORD Worker secret before first deployment.")

os.environ["CLOUDFLARE_WORKERS"] = "1"
os.environ.setdefault("COOKIE_SECURE", "1")

# Patch Jinja2Templates before app.core.ui constructs its templates object.
from jinja2 import ChoiceLoader, DictLoader
from fastapi.templating import Jinja2Templates

try:
    from _templates_data import TEMPLATES as _EMBEDDED_TEMPLATES
except ImportError as exc:
    raise RuntimeError(
        "Template bundle missing. Run cloudflare/build.py before deploying."
    ) from exc

_original_init = Jinja2Templates.__init__


def _workers_templates_init(self, *args, **kwargs):
    _original_init(self, *args, **kwargs)
    self.env.loader = ChoiceLoader([DictLoader(_EMBEDDED_TEMPLATES), self.env.loader])


Jinja2Templates.__init__ = _workers_templates_init

from fastapi import HTTPException, Request
from fastapi.responses import Response
from app.main import app


async def _serve_static(path: str, request: Request) -> Response:
    """Forward /static/* to Cloudflare's static asset binding."""
    runtime_env = request.scope.get("env")
    assets = getattr(runtime_env, "ASSETS", None) if runtime_env is not None else None
    if assets is None:
        raise HTTPException(status_code=404, detail="Static asset binding is not configured")
    asset_response = await assets.fetch(f"https://assets.local/{path}")
    body = await asset_response.bytes()
    return Response(
        content=body,
        status_code=asset_response.status,
        headers=dict(asset_response.headers),
    )


app.add_api_route(
    "/static/{path:path}",
    _serve_static,
    methods=["GET", "HEAD"],
    include_in_schema=False,
)

# Cloudflare's TCP socket bridge supports synchronous SQLAlchemy, but concurrent
# sync DB calls in one isolate must be serialized. Static asset reads stay concurrent.
_worker_db_lock = asyncio.Lock()
_worker_initialized = False


@app.middleware("http")
async def _initialize_and_serialize_worker_requests(request: Request, call_next):
    global _worker_initialized
    if request.url.path.startswith("/static/"):
        return await call_next(request)
    async with _worker_db_lock:
        # Also initialize lazily on the first request in case the ASGI adapter
        # does not emit lifespan startup events in a given runtime version.
        if not _worker_initialized:
            from app.db.bootstrap import migrate, seed

            migrate()
            seed()
            _worker_initialized = True
        return await call_next(request)


from workers import asgi

Default = asgi.entrypoint(app)
