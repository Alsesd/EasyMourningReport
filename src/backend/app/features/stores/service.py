"""Stores management, uniqueness enforcement, and account linking."""

from __future__ import annotations

from fastapi import HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, delete, select

import app.core.backup as backup_mod
from app.core.errors import DomainError
from app.core.validation import clean_name, norm_name
from app.features.audit.service import record_audit
from app.features.auth.models import User
from app.features.auth.schemas import MessageDTO, StorePasswordDTO
from app.features.auth.service import (
    clean_login,
    create_store_user,
    delete_store_user,
    new_password,
    reset_store_user_password,
    update_store_user_login,
)
from app.features.stores.models import Store
from app.features.stores.schemas import (
    MutationDTO,
    StoreCreateDTO,
    StoreDTO,
    StoreUpdateDTO,
)
from app.features.users.service import department_user_to_dto


def same_name(a: str, b: str) -> bool:
    return norm_name(a).casefold() == norm_name(b).casefold()


def check_unique_store(
    db: Session,
    name: str,
    login: str = "",
    store_id: int | None = None,
    user_id: int | None = None,
) -> None:
    """Department names and optional logins must be unique; case and spaces are normalized."""
    for s in db.scalars(select(Store)):
        if s.id != store_id and same_name(s.name, name):
            raise DomainError(
                f"Відділ із назвою «{s.name}» уже існує"
                + (" (в архіві)" if s.archived else "")
            )
    if not login:
        return
    other = db.scalar(
        select(User).where(User.login == login, User.id != (user_id or 0))
    )
    if other:
        raise DomainError(
            f"Логін «{login}» уже зайнятий. "
            "Логіни не залежать від регістру: Store1 і store1 — той самий."
        )


def _get_store_report_counts(db: Session) -> dict[int, int]:
    from app.features.reports.service import get_store_report_counts

    return get_store_report_counts(db)


def store_to_dto(
    db: Session,
    store: Store,
    store_user: User | None = None,
    report_counts: dict[int, int] | None = None,
    store_users: list[User] | None = None,
) -> StoreDTO:
    if store_users is None:
        store_users = list(
            db.scalars(
                select(User)
                .where(User.store_id == store.id, User.role == "store")
                .order_by(User.name, User.login)
            )
        )
    counts = (
        report_counts
        if report_counts is not None
        else _get_store_report_counts(db)
    )
    if store_user is None and store_users:
        store_user = store_users[0]
    return StoreDTO(
        id=store.id,
        name=store.name,
        login=store_user.login if store_user else "",
        archived=store.archived,
        reports_count=counts.get(store.id, 0),
        users=[department_user_to_dto(account) for account in store_users],
    )


def list_stores(db: Session) -> list[StoreDTO]:
    stores = db.scalars(select(Store).order_by(Store.name)).all()
    grouped: dict[int, list[User]] = {}
    for account in db.scalars(
        select(User)
        .where(User.role == "store")
        .order_by(User.name, User.login)
    ):
        grouped.setdefault(account.store_id, []).append(account)
    counts = _get_store_report_counts(db)
    result = []
    for store in stores:
        accounts = grouped.get(store.id, [])
        result.append(
            store_to_dto(
                db,
                store,
                accounts[0] if accounts else None,
                counts,
                accounts,
            )
        )
    return result


def create_store(
    db: Session,
    payload: StoreCreateDTO,
    user: User,
    request: Request,
) -> StoreDTO:
    name = clean_name(payload.name, "Назва відділу")
    login = clean_login(payload.login) if payload.login else ""
    if bool(login) != bool(payload.password):
        raise DomainError("Для облікового запису вкажіть і логін, і пароль.")
    password = new_password(payload.password) if payload.password else ""
    check_unique_store(db, name, login)
    store = Store(name=name)
    db.add(store)
    account = None
    try:
        db.flush()
        if login:
            account = create_store_user(db, login, password, store.id)
        record_audit(
            db,
            request,
            user.login,
            user.role,
            "додано відділ",
            f"{name}" + (f" · логін {login}" if login else ""),
        )
        db.commit()
        db.refresh(store)
        if account:
            db.refresh(account)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Відділ із такою назвою або логін уже існує.",
        )
    return store_to_dto(db, store, account, {}, [account] if account else [])


def update_store(
    db: Session,
    sid: int,
    payload: StoreUpdateDTO,
    user: User,
    request: Request,
) -> StoreDTO:
    store = db.get(Store, sid)
    account = db.scalar(
        select(User)
        .where(User.store_id == sid, User.role == "store")
        .order_by(User.id)
    )
    if not store:
        raise HTTPException(status_code=404, detail="Відділ не знайдено.")
    name = clean_name(payload.name, "Назва відділу")
    login = clean_login(payload.login) if payload.login else ""
    check_unique_store(
        db,
        name,
        login,
        store_id=sid,
        user_id=account.id if account else None,
    )
    notes = []
    if store.name != name:
        notes.append(f"назва «{store.name}» → «{name}»")
        store.name = name
    if account and login and account.login != login:
        notes.append(f"логін {account.login} → {login}")
        update_store_user_login(db, sid, login)
    if notes:
        record_audit(
            db,
            request,
            user.login,
            user.role,
            "змінено відділ",
            "; ".join(notes),
        )
    try:
        db.commit()
        db.refresh(store)
        if account:
            db.refresh(account)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Відділ із такою назвою або логін уже існує.",
        )
    return store_to_dto(db, store, account)


def reset_store_password_service(
    db: Session,
    sid: int,
    payload: StorePasswordDTO,
    user: User,
    request: Request,
) -> MessageDTO:
    pw = new_password(payload.password)
    account = reset_store_user_password(db, sid, pw)
    record_audit(
        db,
        request,
        user.login,
        user.role,
        "змінено пароль магазину",
        account.login,
    )
    db.commit()
    return MessageDTO(message=f"Пароль для «{account.login}» змінено.")


def archive_or_delete_store(
    db: Session,
    sid: int,
    user: User,
    request: Request,
):
    from app.features.reports.service import count_store_reports

    store = db.get(Store, sid)
    if not store:
        raise HTTPException(status_code=404, detail="Відділ не знайдено.")
    count = count_store_reports(db, sid)
    if count:
        store.archived = True
        record_audit(
            db,
            request,
            user.login,
            user.role,
            "архівовано відділ",
            f"{store.name} · звітів: {count}",
        )
        db.commit()
        return MutationDTO(
            id=sid,
            archived=True,
            message=f"«{store.name}» переміщено в архів. Звіти збережено.",
        )
    backup_mod.backup_db("before-delete")
    name = store.name
    delete_store_user(db, sid)
    db.execute(delete(Store).where(Store.id == sid))
    record_audit(db, request, user.login, user.role, "видалено відділ", name)
    db.commit()
    return MutationDTO(
        id=sid, deleted=True, message=f"Відділ «{name}» остаточно видалено."
    )


def restore_store(
    db: Session,
    sid: int,
    user: User,
    request: Request,
) -> StoreDTO:
    store = db.get(Store, sid)
    if not store:
        raise HTTPException(status_code=404, detail="Відділ не знайдено.")
    store.archived = False
    record_audit(
        db, request, user.login, user.role, "відновлено відділ", store.name
    )
    db.commit()
    db.refresh(store)
    return store_to_dto(db, store)


__all__ = [
    "archive_or_delete_store",
    "check_unique_store",
    "create_store",
    "list_stores",
    "norm_name",
    "reset_store_password_service",
    "restore_store",
    "same_name",
    "store_to_dto",
    "update_store",
]
