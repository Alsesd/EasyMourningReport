"""User administration, department assignment, and permission validation."""

from __future__ import annotations

from fastapi import HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.errors import DomainError
from app.core.security import hash_pw
from app.core.validation import clean_name, norm_name
from app.features.audit.service import record_audit
from app.features.auth.models import User
from app.features.auth.permissions import (
    decode_permissions,
    encode_permissions,
    normalize_permissions,
)
from app.features.auth.service import clean_login, new_password
from app.features.stores.models import Store
from app.features.users.schemas import (
    DepartmentUserDTO,
    UserCreateDTO,
    UserDTO,
    UserUpdateDTO,
)


def _permissions_or_error(values: list[str]) -> list[str]:
    try:
        return normalize_permissions(values)
    except ValueError as exc:
        raise DomainError(str(exc)) from exc


def user_to_dto(user: User) -> UserDTO:
    return UserDTO(
        id=user.id,
        name=user.display_name,
        login=user.login,
        role=user.role,
        department_id=user.store_id,
        department_name=user.store.name if user.store else None,
        permissions=decode_permissions(user.permissions, user.role),
    )


def department_user_to_dto(user: User) -> DepartmentUserDTO:
    return DepartmentUserDTO(
        id=user.id,
        name=user.display_name,
        login=user.login,
        permissions=decode_permissions(user.permissions, user.role),
    )


def list_users(db: Session) -> list[UserDTO]:
    users = db.scalars(select(User).order_by(User.role, User.name, User.login))
    return [user_to_dto(user) for user in users]


def _find_login(db: Session, login: str, exclude_id: int | None = None) -> User | None:
    return db.scalar(
        select(User).where(User.login == login, User.id != (exclude_id or 0))
    )


def _resolve_department(
    db: Session,
    department_id: int | None,
    department_name: str | None,
    current_store_id: int | None = None,
) -> Store:
    if department_id is not None and department_name and department_name.strip():
        raise DomainError("Оберіть існуючий відділ або введіть назву нового, не обидва варіанти.")
    if department_name and department_name.strip():
        name = clean_name(department_name, "Назва відділу")
        for store in db.scalars(select(Store)):
            if norm_name(store.name).casefold() == name.casefold():
                if store.id == current_store_id and not store.archived:
                    return store
                raise DomainError(
                    f"Відділ із назвою «{store.name}» уже існує"
                    + (" (в архіві)" if store.archived else "")
                )
        store = Store(name=name)
        db.add(store)
        db.flush()
        return store
    if department_id is None:
        raise DomainError("Оберіть відділ або створіть новий.")
    store = db.get(Store, department_id)
    if not store:
        raise DomainError("Відділ не знайдено.")
    if store.archived:
        raise DomainError("Не можна призначити користувача в архівний відділ.")
    return store


def create_user(
    db: Session,
    payload: UserCreateDTO,
    actor: User,
    request: Request,
) -> UserDTO:
    name = clean_name(payload.name, "Ім'я користувача")
    login = clean_login(payload.login)
    password = new_password(payload.password)
    permissions = _permissions_or_error(payload.permissions)
    if _find_login(db, login):
        raise DomainError(f"Логін «{login}» уже зайнятий.")
    store = _resolve_department(db, payload.department_id, payload.department_name)
    user = User(
        name=name,
        login=login,
        password_hash=hash_pw(password),
        role="store",
        permissions=encode_permissions(permissions),
        store_id=store.id,
    )
    db.add(user)
    try:
        db.flush()
        record_audit(
            db,
            request,
            actor.login,
            actor.role,
            "створено користувача",
            f"{login} · {store.name} · {', '.join(permissions)}",
        )
        db.commit()
        db.refresh(user)
        db.refresh(store)
        user.store = store
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Логін уже зайнятий.")
    return user_to_dto(user)


def update_user(
    db: Session,
    uid: int,
    payload: UserUpdateDTO,
    actor: User,
    request: Request,
) -> UserDTO:
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено.")
    if user.role == "admin":
        raise DomainError("Головного адміністратора не можна редагувати на цій сторінці.")
    name = clean_name(payload.name, "Ім'я користувача")
    login = clean_login(payload.login)
    permissions = _permissions_or_error(payload.permissions)
    if _find_login(db, login, exclude_id=user.id):
        raise DomainError(f"Логін «{login}» уже зайнятий.")
    store = _resolve_department(
        db,
        payload.department_id,
        payload.department_name,
        current_store_id=user.store_id,
    )
    notes: list[str] = []
    if user.name != name:
        notes.append(f"ім'я «{user.name or user.login}» → «{name}»")
        user.name = name
    if user.login != login:
        notes.append(f"логін {user.login} → {login}")
        user.login = login
    if user.store_id != store.id:
        notes.append(f"відділ «{user.store.name if user.store else '—'}» → «{store.name}»")
        user.store_id = store.id
        user.store = store
    old_permissions = decode_permissions(user.permissions, user.role)
    if old_permissions != permissions:
        notes.append(f"права: {', '.join(old_permissions)} → {', '.join(permissions)}")
        user.permissions = encode_permissions(permissions)
    if payload.password:
        notes.append("пароль змінено")
        user.password_hash = hash_pw(new_password(payload.password))
    if notes:
        record_audit(
            db,
            request,
            actor.login,
            actor.role,
            "змінено користувача",
            f"{login}: " + "; ".join(notes),
        )
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Логін уже зайнятий.")
    return user_to_dto(user)


def delete_user(
    db: Session,
    uid: int,
    actor: User,
    request: Request,
) -> None:
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено.")
    if user.role == "admin" or actor.id == user.id:
        raise DomainError("Головного адміністратора не можна видалити.")
    login = user.login
    db.delete(user)
    record_audit(
        db, request, actor.login, actor.role, "видалено користувача", login
    )
    db.commit()


__all__ = [
    "create_user",
    "delete_user",
    "department_user_to_dto",
    "list_users",
    "update_user",
    "user_to_dto",
]
