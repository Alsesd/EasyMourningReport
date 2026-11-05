"""Transport orders (scaffold): organisations submit orders, staff track them through statuses.

This package is the template for a new module. Everything the feature needs lives here:

* ``permissions.py`` – permission codes, offered in the role editor automatically;
* ``models.py``      – SQLModel tables (list them in ``models=`` below);
* ``schemas.py``     – request/response DTOs;
* ``routes.py``      – an ``APIRouter`` mounted under ``/api/v1``; use ``/transport/...`` paths;
* ``migrations.py``  – schema changes after the first release (none yet);
* ``tests/``         – picked up by pytest automatically.

The module is registered in ``app/modules/__init__.py``; the frontend half lives in
``frontend/src/modules/transport/``.
"""

from app.core.modules import Module
from app.modules.transport.permissions import PERMISSIONS
from app.modules.transport.routes import router

module = Module(
    name="transport",
    title="Транспорт",
    router=router,
    permissions=PERMISSIONS,
    models=(),
    migrations=(),
    audit_actions=(),
    # Members of an organisation's built-in "Магазин" role will be able to place orders once enabled:
    # default_grants={"store": (CREATE,)},
)
