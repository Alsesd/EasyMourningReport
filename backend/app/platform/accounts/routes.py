"""REST endpoints for organisations, users, roles and the permission catalogue."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.dependencies import clean_login, clean_name, new_password
from app.core.errors import FormError
from app.core.schemas import MessageDTO, MutationDTO, PasswordDTO
from app.core.security import hash_pw
from app.db.backup import backup_db
from app.db.session import get_db
from app.platform.accounts.access import Principal, require, role_permissions
from app.platform.accounts.models import Organisation, Role, RolePermission, User, UserRole
from app.platform.accounts.permissions import (
    ALL_OF_SCOPE,
    ORG_USERS_MANAGE,
    ORGANISATIONS_MANAGE,
    ROLES_MANAGE,
    STORE,
    USERS_MANAGE,
)
from app.platform.accounts.schemas import (
    OrganisationCreateDTO,
    OrganisationDTO,
    OrganisationRefDTO,
    OrganisationUpdateDTO,
    PermissionDTO,
    RoleDTO,
    RoleInputDTO,
    UserCreateDTO,
    UserDTO,
    UserUpdateDTO,
)
from app.platform.accounts.service import (
    assignable_roles,
    check_admin_remains,
    check_can_manage_user,
    check_unique_login,
    check_unique_organisation,
    managed_organisation,
    resolve_roles,
    resolve_target_organisation,
    role_by_key,
)
from app.platform.audit.service import audit
from app.platform.registry import get_registry

router = APIRouter(tags=["Accounts"])

ANY_ACCOUNT_MANAGER = (USERS_MANAGE, ORG_USERS_MANAGE)


def _clean_full_name(raw: str) -> str:
    return " ".join((raw or "").split())[:100]


# --- permissions ------------------------------------------------------------------


@router.get("/permissions", response_model=list[PermissionDTO])
def list_permissions(
    _: Principal = Depends(require(ROLES_MANAGE, *ANY_ACCOUNT_MANAGER)),
) -> list[PermissionDTO]:
    return [
        PermissionDTO(
            code=p.code,
            label=p.label,
            description=p.description,
            scope=p.scope,
            module=m.name,
            module_title=m.title,
        )
        for m, p in get_registry().permissions()
    ]


# --- organisations ----------------------------------------------------------------


def _organisation_dto(
    org: Organisation, user_counts: dict[int, int], usage: dict[int, dict[str, int]]
) -> OrganisationDTO:
    return OrganisationDTO(
        id=org.id,
        name=org.name,
        archived=org.archived,
        user_count=user_counts.get(org.id, 0),
        usage=usage.get(org.id, {}),
    )


def _user_counts(db: Session) -> dict[int, int]:
    return {
        oid: count
        for oid, count in db.execute(
            select(User.organisation_id, func.count(User.id))
            .where(User.organisation_id.is_not(None))
            .group_by(User.organisation_id)
        )
    }


def _one_organisation_dto(db: Session, org: Organisation) -> OrganisationDTO:
    return _organisation_dto(org, _user_counts(db), get_registry().organisation_usage(db))


@router.get("/organisations", response_model=list[OrganisationDTO])
def list_organisations(
    _: Principal = Depends(require(ORGANISATIONS_MANAGE, USERS_MANAGE, ROLES_MANAGE)),
    db: Session = Depends(get_db),
) -> list[OrganisationDTO]:
    counts, usage = _user_counts(db), get_registry().organisation_usage(db)
    orgs = db.scalars(select(Organisation)).all()
    return [
        _organisation_dto(o, counts, usage)
        for o in sorted(orgs, key=lambda o: o.name.casefold())
    ]


@router.post("/organisations", response_model=OrganisationDTO, status_code=status.HTTP_201_CREATED)
def create_organisation(
    payload: OrganisationCreateDTO,
    request: Request,
    principal: Principal = Depends(require(ORGANISATIONS_MANAGE)),
    db: Session = Depends(get_db),
) -> OrganisationDTO:
    name = clean_name(payload.name, "Назва організації")
    check_unique_organisation(db, name)
    org = Organisation(name=name)
    db.add(org)
    detail = name
    try:
        db.flush()
        if payload.first_user:
            if not principal.can(USERS_MANAGE):
                raise HTTPException(status_code=403, detail="Недостатньо прав для створення користувачів.")
            login = clean_login(payload.first_user.login)
            check_unique_login(db, login)
            account = User(
                login=login,
                password_hash=hash_pw(new_password(payload.first_user.password)),
                organisation_id=org.id,
            )
            account.roles = [role_by_key(db, STORE)]
            db.add(account)
            detail += f" · логін {login}"
        audit(db, request, principal.login, principal.role_label, "додано організацію", detail)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Організація з такою назвою або логін уже існує.")
    db.refresh(org)
    return _one_organisation_dto(db, org)


def _get_organisation(db: Session, oid: int) -> Organisation:
    org = db.get(Organisation, oid)
    if not org:
        raise HTTPException(status_code=404, detail="Організацію не знайдено.")
    return org


@router.put("/organisations/{oid}", response_model=OrganisationDTO)
def update_organisation(
    oid: int,
    payload: OrganisationUpdateDTO,
    request: Request,
    principal: Principal = Depends(require(ORGANISATIONS_MANAGE)),
    db: Session = Depends(get_db),
) -> OrganisationDTO:
    org = _get_organisation(db, oid)
    name = clean_name(payload.name, "Назва організації")
    check_unique_organisation(db, name, oid)
    if org.name != name:
        audit(db, request, principal.login, principal.role_label, "змінено організацію", f"«{org.name}» → «{name}»")
        org.name = name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Організація з такою назвою вже існує.")
    return _one_organisation_dto(db, org)


@router.delete("/organisations/{oid}", response_model=MutationDTO)
def delete_organisation(
    oid: int,
    request: Request,
    principal: Principal = Depends(require(ORGANISATIONS_MANAGE)),
    db: Session = Depends(get_db),
) -> MutationDTO:
    """Archive an organisation that has records in any module; delete it (and its users) otherwise."""
    org = _get_organisation(db, oid)
    usage = get_registry().organisation_usage(db).get(oid, {})
    if usage:
        org.archived = True
        detail = ", ".join(f"{k}: {v}" for k, v in usage.items())
        audit(db, request, principal.login, principal.role_label, "архівовано організацію", f"{org.name} · {detail}")
        db.commit()
        return MutationDTO(id=oid, archived=True, message=f"«{org.name}» переміщено в архів. Дані збережено.")
    backup_db("before-delete")
    name = org.name
    user_ids = list(db.scalars(select(User.id).where(User.organisation_id == oid)))
    if user_ids:
        db.execute(delete(UserRole).where(UserRole.user_id.in_(user_ids)))
        db.execute(delete(User).where(User.id.in_(user_ids)))
    role_ids = list(db.scalars(select(Role.id).where(Role.organisation_id == oid)))
    if role_ids:
        db.execute(delete(UserRole).where(UserRole.role_id.in_(role_ids)))
        db.execute(delete(RolePermission).where(RolePermission.role_id.in_(role_ids)))
        db.execute(delete(Role).where(Role.id.in_(role_ids)))
    db.execute(delete(Organisation).where(Organisation.id == oid))
    audit(db, request, principal.login, principal.role_label, "видалено організацію", name)
    db.commit()
    return MutationDTO(id=oid, deleted=True, message=f"Організацію «{name}» остаточно видалено.")


@router.post("/organisations/{oid}/restore", response_model=OrganisationDTO)
def restore_organisation(
    oid: int,
    request: Request,
    principal: Principal = Depends(require(ORGANISATIONS_MANAGE)),
    db: Session = Depends(get_db),
) -> OrganisationDTO:
    org = _get_organisation(db, oid)
    org.archived = False
    audit(db, request, principal.login, principal.role_label, "відновлено організацію", org.name)
    db.commit()
    return _one_organisation_dto(db, org)


# --- users ------------------------------------------------------------------------


def _user_dto(user: User) -> UserDTO:
    return UserDTO(
        id=user.id,
        login=user.login,
        full_name=user.full_name,
        active=user.active,
        organisation=(
            OrganisationRefDTO(id=user.organisation.id, name=user.organisation.name)
            if user.organisation
            else None
        ),
        role_ids=sorted(r.id for r in user.roles),
        role_names=sorted(r.name for r in user.roles),
    )


def _get_user(db: Session, principal: Principal, uid: int) -> User:
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено.")
    check_can_manage_user(principal, user)
    return user


def _check_kept_roles(principal: Principal, user: User, new_roles: list[Role], organisation_id: int | None) -> list[Role]:
    """Org managers may not strip roles they could not have granted; keep those unchanged."""
    if principal.can(USERS_MANAGE):
        return new_roles
    kept = [
        r for r in user.roles
        if not role_permissions(r) <= principal.permissions and r.organisation_id in (None, organisation_id)
    ]
    return list({r.id: r for r in [*kept, *new_roles]}.values())


@router.get("/users", response_model=list[UserDTO])
def list_users(
    organisation_id: int | None = None,
    platform: bool = False,
    principal: Principal = Depends(require(*ANY_ACCOUNT_MANAGER)),
    db: Session = Depends(get_db),
) -> list[UserDTO]:
    limit = managed_organisation(principal)
    query = select(User)
    if limit is not None:
        query = query.where(User.organisation_id == limit)
    elif platform:
        query = query.where(User.organisation_id.is_(None))
    elif organisation_id is not None:
        query = query.where(User.organisation_id == organisation_id)
    return [_user_dto(u) for u in db.scalars(query.order_by(User.login))]


@router.post("/users", response_model=UserDTO, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateDTO,
    request: Request,
    principal: Principal = Depends(require(*ANY_ACCOUNT_MANAGER)),
    db: Session = Depends(get_db),
) -> UserDTO:
    org = resolve_target_organisation(db, principal, payload.organisation_id)
    login = clean_login(payload.login)
    check_unique_login(db, login)
    roles = resolve_roles(db, principal, org.id if org else None, payload.role_ids)
    user = User(
        login=login,
        password_hash=hash_pw(new_password(payload.password)),
        full_name=_clean_full_name(payload.full_name),
        active=payload.active,
        organisation_id=org.id if org else None,
    )
    user.roles = roles
    db.add(user)
    audit(
        db, request, principal.login, principal.role_label, "додано користувача",
        f"{login} · {org.name if org else 'платформа'} · {', '.join(r.name for r in roles) or 'без ролі'}",
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Такий логін уже існує.")
    db.refresh(user)
    return _user_dto(user)


@router.put("/users/{uid}", response_model=UserDTO)
def update_user(
    uid: int,
    payload: UserUpdateDTO,
    request: Request,
    principal: Principal = Depends(require(*ANY_ACCOUNT_MANAGER)),
    db: Session = Depends(get_db),
) -> UserDTO:
    user = _get_user(db, principal, uid)
    org = resolve_target_organisation(db, principal, payload.organisation_id)
    org_id = org.id if org else None
    login = clean_login(payload.login)
    check_unique_login(db, login, uid)
    roles = _check_kept_roles(principal, user, resolve_roles(db, principal, org_id, payload.role_ids), org_id)
    if user.id == principal.id and not payload.active:
        raise FormError("Не можна вимкнути власний обліковий запис.")

    notes = []
    if user.login != login:
        notes.append(f"логін {user.login} → {login}")
        user.login = login
    full_name = _clean_full_name(payload.full_name)
    if user.full_name != full_name:
        notes.append("змінено ім'я")
        user.full_name = full_name
    if user.organisation_id != org_id:
        notes.append(f"організація → {org.name if org else 'платформа'}")
        user.organisation_id = org_id
        user.organisation = org
    if user.active != payload.active:
        notes.append("увімкнено" if payload.active else "вимкнено")
        user.active = payload.active
    if {r.id for r in user.roles} != {r.id for r in roles}:
        notes.append(f"ролі: {', '.join(sorted(r.name for r in roles)) or 'немає'}")
        user.roles = roles
    check_admin_remains(db)
    if notes:
        audit(db, request, principal.login, principal.role_label, "змінено користувача", f"{user.login}: " + "; ".join(notes))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Такий логін уже існує.")
    db.refresh(user)
    return _user_dto(user)


@router.put("/users/{uid}/password", response_model=MessageDTO)
def reset_user_password(
    uid: int,
    payload: PasswordDTO,
    request: Request,
    principal: Principal = Depends(require(*ANY_ACCOUNT_MANAGER)),
    db: Session = Depends(get_db),
) -> MessageDTO:
    user = _get_user(db, principal, uid)
    if not principal.can(USERS_MANAGE) and not role_permissions_subset(user, principal):
        raise HTTPException(status_code=403, detail="Недостатньо прав для зміни цього пароля.")
    user.password_hash = hash_pw(new_password(payload.password))
    audit(db, request, principal.login, principal.role_label, "змінено пароль користувача", user.login)
    db.commit()
    return MessageDTO(message=f"Пароль для «{user.login}» змінено.")


def role_permissions_subset(user: User, principal: Principal) -> bool:
    """An org manager may only act on accounts that hold no more than they do."""
    granted: set[str] = set()
    for r in user.roles:
        granted |= role_permissions(r)
    return granted <= principal.permissions


@router.delete("/users/{uid}", response_model=MutationDTO)
def delete_user(
    uid: int,
    request: Request,
    principal: Principal = Depends(require(*ANY_ACCOUNT_MANAGER)),
    db: Session = Depends(get_db),
) -> MutationDTO:
    user = _get_user(db, principal, uid)
    if user.id == principal.id:
        raise FormError("Не можна видалити власний обліковий запис.")
    if not principal.can(USERS_MANAGE) and not role_permissions_subset(user, principal):
        raise HTTPException(status_code=403, detail="Недостатньо прав для видалення цього користувача.")
    login = user.login
    db.execute(delete(UserRole).where(UserRole.user_id == uid))
    db.delete(user)
    check_admin_remains(db)
    audit(db, request, principal.login, principal.role_label, "видалено користувача", login)
    db.commit()
    return MutationDTO(id=uid, deleted=True, message=f"Користувача «{login}» видалено.")


# --- roles ------------------------------------------------------------------------


def _role_dto(role: Role, user_counts: dict[int, int], org_names: dict[int, str]) -> RoleDTO:
    return RoleDTO(
        id=role.id,
        key=role.key,
        name=role.name,
        scope=role.scope,
        organisation_id=role.organisation_id,
        organisation_name=org_names.get(role.organisation_id) if role.organisation_id else None,
        permissions=sorted(role_permissions(role)),
        built_in=role.key is not None,
        all_permissions=role.key in ALL_OF_SCOPE,
        user_count=user_counts.get(role.id, 0),
    )


def _role_context(db: Session) -> tuple[dict[int, int], dict[int, str]]:
    counts = {
        rid: n
        for rid, n in db.execute(select(UserRole.role_id, func.count(UserRole.user_id)).group_by(UserRole.role_id))
    }
    names = {o.id: o.name for o in db.scalars(select(Organisation))}
    return counts, names


@router.get("/roles", response_model=list[RoleDTO])
def list_roles(
    organisation_id: int | None = None,
    principal: Principal = Depends(require(ROLES_MANAGE, *ANY_ACCOUNT_MANAGER)),
    db: Session = Depends(get_db),
) -> list[RoleDTO]:
    """All roles for role managers; otherwise the roles the caller may assign."""
    counts, names = _role_context(db)
    if principal.can(ROLES_MANAGE, USERS_MANAGE) and organisation_id is None:
        roles = list(db.scalars(select(Role)))
    else:
        target = managed_organisation(principal) if not principal.can(USERS_MANAGE) else organisation_id
        roles = assignable_roles(db, principal, target)
    roles.sort(key=lambda r: (r.scope != "platform", r.key is None, r.name.casefold()))
    return [_role_dto(r, counts, names) for r in roles]


def _validated_permissions(scope: str, codes: list[str]) -> list[str]:
    allowed = get_registry().codes(scope)  # type: ignore[arg-type]
    unknown = [c for c in codes if c not in allowed]
    if unknown:
        raise FormError(f"Дозволи не підходять для цього типу ролі: {', '.join(unknown)}")
    return sorted(set(codes))


def _check_role_name(db: Session, name: str, organisation_id: int | None, role_id: int | None = None) -> None:
    for other in db.scalars(select(Role).where(Role.id != (role_id or 0))):
        if other.organisation_id == organisation_id and other.name.casefold() == name.casefold():
            raise FormError(f"Роль «{other.name}» уже існує.")


@router.post("/roles", response_model=RoleDTO, status_code=status.HTTP_201_CREATED)
def create_role(
    payload: RoleInputDTO,
    request: Request,
    principal: Principal = Depends(require(ROLES_MANAGE)),
    db: Session = Depends(get_db),
) -> RoleDTO:
    name = clean_name(payload.name, "Назва ролі")
    org_id = payload.organisation_id if payload.scope == "organisation" else None
    if org_id is not None:
        _get_organisation(db, org_id)
    _check_role_name(db, name, org_id)
    codes = _validated_permissions(payload.scope, payload.permissions)
    role = Role(name=name, scope=payload.scope, organisation_id=org_id)
    db.add(role)
    db.flush()
    role.grants = [RolePermission(role_id=role.id, permission=c) for c in codes]
    audit(db, request, principal.login, principal.role_label, "додано роль", f"{name}: {', '.join(codes) or '—'}")
    db.commit()
    db.refresh(role)
    counts, names = _role_context(db)
    return _role_dto(role, counts, names)


def _get_role(db: Session, rid: int) -> Role:
    role = db.get(Role, rid)
    if not role:
        raise HTTPException(status_code=404, detail="Роль не знайдено.")
    return role


@router.put("/roles/{rid}", response_model=RoleDTO)
def update_role(
    rid: int,
    payload: RoleInputDTO,
    request: Request,
    principal: Principal = Depends(require(ROLES_MANAGE)),
    db: Session = Depends(get_db),
) -> RoleDTO:
    role = _get_role(db, rid)
    if payload.scope != role.scope:
        raise FormError("Тип ролі (платформа чи організація) змінити не можна.")
    name = clean_name(payload.name, "Назва ролі")
    org_id = role.organisation_id if role.key else (payload.organisation_id if role.scope == "organisation" else None)
    if org_id is not None:
        _get_organisation(db, org_id)
    if org_id != role.organisation_id:
        assigned_elsewhere = db.scalar(
            select(func.count(User.id))
            .join(UserRole, UserRole.user_id == User.id)
            .where(UserRole.role_id == rid, User.organisation_id != org_id)
        )
        if org_id is not None and assigned_elsewhere:
            raise FormError("Роль призначено користувачам інших організацій; спершу зніміть її з них.")
    _check_role_name(db, name, org_id, rid)
    notes = []
    if role.name != name:
        notes.append(f"назва «{role.name}» → «{name}»")
        role.name = name
    role.organisation_id = org_id
    if role.key not in ALL_OF_SCOPE:
        codes = _validated_permissions(role.scope, payload.permissions)
        if sorted(g.permission for g in role.grants) != codes:
            role.grants = [RolePermission(role_id=role.id, permission=c) for c in codes]
            notes.append(f"дозволи: {', '.join(codes) or '—'}")
    if notes:
        audit(db, request, principal.login, principal.role_label, "змінено роль", f"{role.name}: " + "; ".join(notes))
    db.commit()
    db.refresh(role)
    counts, names = _role_context(db)
    return _role_dto(role, counts, names)


@router.delete("/roles/{rid}", response_model=MutationDTO)
def delete_role(
    rid: int,
    request: Request,
    principal: Principal = Depends(require(ROLES_MANAGE)),
    db: Session = Depends(get_db),
) -> MutationDTO:
    role = _get_role(db, rid)
    if role.key:
        raise FormError("Вбудовану роль видалити не можна.")
    name = role.name
    db.execute(delete(UserRole).where(UserRole.role_id == rid))
    db.delete(role)
    audit(db, request, principal.login, principal.role_label, "видалено роль", name)
    db.commit()
    return MutationDTO(id=rid, deleted=True, message=f"Роль «{name}» видалено.")
