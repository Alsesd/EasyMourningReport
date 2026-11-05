"""Installed feature modules.

To add a module: create ``app/modules/<name>/`` exposing ``module = Module(...)`` from its
``__init__.py`` (see ``app/core/modules.py`` and ``app/modules/transport`` for a template),
then add it to this tuple. Order matters only for migrations and navigation.
"""

from app.modules.reports import module as reports
from app.modules.transport import module as transport

INSTALLED_MODULES = (reports, transport)
