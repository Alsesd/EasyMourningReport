"""Admin store management endpoints: add, edit, delete, restore, password reset."""

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import (
    FormError,
    admin_required,
    clean_login,
    clean_name,
    done,
    get_db,
    hash_pw,
    new_password,
)
from app.db import Report, Store, User, audit, backup_db
from app.db.repositories import check_unique_store

router = APIRouter()


@router.post("")
def store_add(
    request: Request,
    name: str = Form(),
    login: str = Form(),
    password: str = Form(),
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    name, login = clean_name(name, "Назва магазину"), clean_login(login)
    new_password(password)
    check_unique_store(db, name, login)
    store = Store(name=name)
    db.add(store)
    try:
        db.flush()
        db.add(
            User(
                login=login,
                password_hash=hash_pw(password),
                role="store",
                store_id=store.id,
            )
        )
        audit(
            db,
            request,
            user.login,
            user.role,
            "додано магазин",
            f"{name} · логін {login}",
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise FormError("Магазин із такою назвою або логін уже існує")
    return done(
        request,
        f"/admin#s{store.id}",
        f"Магазин «{name}» додано. Логін для входу: {login}.",
    )


@router.post("/{sid}/edit")
def store_edit(
    request: Request,
    sid: int,
    name: str = Form(),
    login: str = Form(),
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    store = db.get(Store, sid)
    store_user = db.scalar(
        select(User).where(User.store_id == sid, User.role == "store")
    )
    if not store or not store_user:
        raise HTTPException(404)
    name, login = clean_name(name, "Назва магазину"), clean_login(login)
    check_unique_store(db, name, login, store_id=sid, user_id=store_user.id)
    notes = []
    if name != store.name:
        notes.append(f"назва «{store.name}» → «{name}»")
        store.name = name
    if login != store_user.login:
        notes.append(f"логін {store_user.login} → {login}")
        store_user.login = login
    if not notes:
        return done(
            request, f"/admin#s{sid}", "Змін немає: нічого не збережено.", "info"
        )
    try:
        audit(
            db, request, user.login, user.role, "змінено магазин", "; ".join(notes)
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise FormError("Магазин із такою назвою або логін уже існує")
    return done(
        request,
        f"/admin#s{sid}",
        "Збережено: " + "; ".join(notes) + ". Пароль і звіти не змінились.",
    )


@router.post("/{sid}/delete")
def store_delete(
    request: Request,
    sid: int,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    s = db.get(Store, sid)
    if not s:
        raise HTTPException(404)
    reports = (
        db.scalar(
            select(func.count(Report.id)).where(Report.store_id == sid)
        )
        or 0
    )
    if reports:  # never touch report data: switch the store off instead
        s.archived = True
        audit(
            db,
            request,
            user.login,
            user.role,
            "архівовано магазин",
            f"{s.name} · звітів: {reports}",
        )
        db.commit()
        return done(
            request,
            "/admin#archive",
            f"«{s.name}» має звіти ({reports}), тому його не видалено, а "
            "переміщено в архів: вхід вимкнено, усі звіти збережено. Магазин можна відновити.",
        )
    backup_db("before-delete")
    name = s.name
    db.execute(delete(User).where(User.store_id == sid))
    db.execute(delete(Store).where(Store.id == sid))
    audit(db, request, user.login, user.role, "видалено магазин", name)
    db.commit()
    return done(
        request, "/admin#stores", f"Магазин «{name}» видалено: звітів у нього не було."
    )


@router.post("/{sid}/restore")
def store_restore(
    request: Request,
    sid: int,
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    s = db.get(Store, sid)
    if not s:
        raise HTTPException(404)
    s.archived = False
    audit(db, request, user.login, user.role, "відновлено магазин", s.name)
    db.commit()
    return done(
        request, f"/admin#s{sid}", f"Магазин «{s.name}» відновлено: вхід знову працює."
    )


@router.post("/{sid}/password")
def store_password(
    request: Request,
    sid: int,
    password: str = Form(),
    user: User = Depends(admin_required),
    db: Session = Depends(get_db),
):
    store_user = db.scalar(
        select(User).where(User.store_id == sid, User.role == "store")
    )
    if not store_user:
        raise HTTPException(404)
    store_user.password_hash = hash_pw(new_password(password))
    audit(
        db,
        request,
        user.login,
        user.role,
        "змінено пароль магазину",
        store_user.login,
    )
    db.commit()
    return done(
        request,
        f"/admin#s{sid}",
        f"Пароль для входу «{store_user.login}» змінено.",
    )
