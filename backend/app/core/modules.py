"""The contract every feature module implements, and the registry that composes them.

A feature module is one package under ``app/modules/<name>/``. It owns its models,
schemas, routes, migrations, permissions and tests, and exposes a single
``module = Module(...)`` object from its ``__init__.py``. The application only
imports that object (see ``app/modules/__init__.py``); nothing else in the core
needs to change when a module is added.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from fastapi import APIRouter
from sqlalchemy.engine import Connection
from sqlmodel import Session

Scope = Literal["platform", "organisation"]


@dataclass(frozen=True)
class Permission:
    """A capability a role can grant.

    ``platform`` permissions apply to staff accounts that do not belong to an
    organisation and act across all organisations. ``organisation`` permissions
    apply to members of one organisation and only ever reach that organisation's
    own data.
    """

    code: str
    label: str
    scope: Scope
    description: str = ""


@dataclass(frozen=True)
class Migration:
    """One schema or data change, applied once and recorded in ``schema_migrations``.

    ``apply`` receives a connection inside a transaction. On a database that is
    created from scratch the migration is only recorded, never run, because the
    current models already describe the final schema; so a migration must cope
    with the state an older release left behind and nothing else.
    """

    id: str
    apply: Callable[[Connection], None]


@dataclass(frozen=True)
class OverviewStat:
    """One figure a module shows on the administration overview (e.g. "Надіслано звітів: 12 / 14")."""

    label: str
    value: str
    hint: str = ""
    # Section of the administration hub the figure links to, if any.
    section: str = ""


@dataclass(frozen=True)
class Module:
    """Everything the platform needs to know about a feature module."""

    name: str
    title: str
    # REST endpoints, mounted under /api/v1. New modules should use /api/v1/<name>/... paths.
    router: APIRouter | None = None
    permissions: Sequence[Permission] = ()
    # Import side effect only: listing the model classes guarantees their tables are registered.
    models: Sequence[type] = ()
    migrations: Sequence[Migration] = ()
    # Audit-log action names this module writes, offered as filters in the audit log.
    audit_actions: Sequence[str] = ()
    # Built-in organisation roles this module contributes default permissions to, by role key.
    default_grants: dict[str, Sequence[str]] = field(default_factory=dict)
    # How many records of this module belong to each organisation, by organisation id.
    # An organisation with records is archived instead of deleted.
    organisation_usage: Callable[[Session], dict[int, int]] | None = None
    # Runs once on an empty database after the first administrator is created (demo data etc.).
    seed: Callable[[Session], None] | None = None
    # Figures for the administration overview: (db, principal) -> stats the principal may see.
    overview: Callable[[Session, Any], list[OverviewStat]] | None = None


class ModuleRegistry:
    """The ordered set of installed modules, with lookups the platform needs."""

    def __init__(self, modules: Sequence[Module]):
        names = [m.name for m in modules]
        if len(names) != len(set(names)):
            raise ValueError(f"Duplicate module names: {names}")
        codes = [p.code for m in modules for p in m.permissions]
        if len(codes) != len(set(codes)):
            raise ValueError(f"Duplicate permission codes: {codes}")
        self.modules = tuple(modules)

    def __iter__(self):
        return iter(self.modules)

    def permissions(self) -> list[tuple[Module, Permission]]:
        return [(m, p) for m in self.modules for p in m.permissions]

    def permission(self, code: str) -> Permission | None:
        for _, p in self.permissions():
            if p.code == code:
                return p
        return None

    def codes(self, scope: Scope | None = None) -> set[str]:
        return {p.code for _, p in self.permissions() if scope is None or p.scope == scope}

    def audit_actions(self) -> list[str]:
        seen: list[str] = []
        for m in self.modules:
            for action in m.audit_actions:
                if action not in seen:
                    seen.append(action)
        return seen

    def organisation_usage(self, db: Session) -> dict[int, dict[str, int]]:
        """organisation id -> {module name: record count}, for modules that report usage."""
        out: dict[int, dict[str, int]] = {}
        for m in self.modules:
            if m.organisation_usage is None:
                continue
            for org_id, count in m.organisation_usage(db).items():
                if count:
                    out.setdefault(org_id, {})[m.name] = count
        return out
