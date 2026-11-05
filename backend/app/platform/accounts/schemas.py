"""DTOs for sign-in, organisations, users, roles and permissions."""

from typing import Literal

from pydantic import BaseModel, Field

from app.core.schemas import DTO


class LoginDTO(BaseModel):
    login: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class OrganisationRefDTO(DTO):
    id: int
    name: str


class SessionDTO(DTO):
    user_id: int
    login: str
    full_name: str = ""
    organisation: OrganisationRefDTO | None = None
    roles: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)
    period: str


class PermissionDTO(DTO):
    code: str
    label: str
    description: str = ""
    scope: Literal["platform", "organisation"]
    module: str
    module_title: str


class RoleDTO(DTO):
    id: int
    key: str | None = None
    name: str
    scope: Literal["platform", "organisation"]
    organisation_id: int | None = None
    organisation_name: str | None = None
    permissions: list[str] = Field(default_factory=list)
    built_in: bool = False
    # True for roles that always hold every permission of their scope; their permissions cannot be edited.
    all_permissions: bool = False
    user_count: int = 0


class RoleInputDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scope: Literal["platform", "organisation"]
    organisation_id: int | None = None
    permissions: list[str] = Field(default_factory=list, max_length=500)


class OrganisationDTO(DTO):
    id: int
    name: str
    archived: bool
    user_count: int = 0
    # Records each module holds for this organisation, e.g. {"reports": 12}.
    usage: dict[str, int] = Field(default_factory=dict)


class FirstUserDTO(BaseModel):
    login: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=6, max_length=256)


class OrganisationCreateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # Optional first account, created with the built-in "Магазин" role.
    first_user: FirstUserDTO | None = None


class OrganisationUpdateDTO(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class UserDTO(DTO):
    id: int
    login: str
    full_name: str = ""
    active: bool
    organisation: OrganisationRefDTO | None = None
    role_ids: list[int] = Field(default_factory=list)
    role_names: list[str] = Field(default_factory=list)


class UserCreateDTO(BaseModel):
    login: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=6, max_length=256)
    full_name: str = Field(default="", max_length=100)
    organisation_id: int | None = None
    role_ids: list[int] = Field(default_factory=list, max_length=50)
    active: bool = True


class UserUpdateDTO(BaseModel):
    login: str = Field(min_length=2, max_length=40)
    full_name: str = Field(default="", max_length=100)
    organisation_id: int | None = None
    role_ids: list[int] = Field(default_factory=list, max_length=50)
    active: bool = True
