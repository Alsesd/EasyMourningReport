"""Organisations, user accounts and roles.

* An **organisation** is a customer-side unit (today: a store). It can have many users.
* A **platform user** has ``organisation_id = None``: agency staff who act across organisations.
* A **role** is a named set of permission codes. Its ``scope`` says which kind of user it can
  be given to. ``organisation_id`` on an organisation-scope role limits it to one organisation;
  ``None`` makes it available to every organisation.
* Built-in roles carry a ``key``. ``platform_admin`` and ``org_admin`` always hold every
  permission of their scope, including ones added by modules installed later.
"""

from datetime import datetime, timezone

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel


class Organisation(SQLModel, table=True):
    __tablename__ = "organisations"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    # Archived organisations keep their history; their users can no longer sign in.
    archived: bool = Field(default=False, index=True)


class UserRole(SQLModel, table=True):
    __tablename__ = "user_roles"

    user_id: int = Field(foreign_key="users.id", primary_key=True, ondelete="CASCADE")
    role_id: int = Field(foreign_key="roles.id", primary_key=True, ondelete="CASCADE")


class RolePermission(SQLModel, table=True):
    __tablename__ = "role_permissions"

    role_id: int = Field(foreign_key="roles.id", primary_key=True, ondelete="CASCADE")
    permission: str = Field(primary_key=True)


class Role(SQLModel, table=True):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("name", "organisation_id"),)

    id: int | None = Field(default=None, primary_key=True)
    # Stable identifier of a built-in role ("platform_admin", "org_admin", "store"); None for custom roles.
    key: str | None = Field(default=None, unique=True, index=True)
    name: str
    scope: str = Field(index=True)  # "platform" | "organisation"
    organisation_id: int | None = Field(
        default=None, foreign_key="organisations.id", index=True, ondelete="CASCADE"
    )

    grants: list[RolePermission] = Relationship(
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin"}
    )


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: int | None = Field(default=None, primary_key=True)
    login: str = Field(unique=True, index=True)
    password_hash: str
    full_name: str = Field(default="", sa_column_kwargs={"server_default": ""})
    active: bool = Field(default=True, sa_column_kwargs={"server_default": "1"})
    organisation_id: int | None = Field(
        default=None, foreign_key="organisations.id", index=True
    )
    created_at: datetime | None = Field(default_factory=lambda: datetime.now(timezone.utc))

    organisation: Organisation | None = Relationship(sa_relationship_kwargs={"lazy": "joined"})
    roles: list[Role] = Relationship(
        link_model=UserRole, sa_relationship_kwargs={"lazy": "selectin"}
    )
