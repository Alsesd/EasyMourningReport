"""Authentication, session credential verification, and user management."""

import re

from fastapi import HTTPException, Request
from sqlmodel import Session, delete, select

from app.core.ratelimit import clear_failures, record_failure, retry_after
from app.core.security import check_pw, client_ip, hash_pw
from app.core.ui import FormError
from app.features.audit.service import record_audit
from app.features.auth.models import User

LOGIN_RE = re.compile(r"\S{2,40}")


def norm_login(raw: str) -> str:
    """Logins are case-insensitive and trimmed."""
    return (raw or "").strip().lower()


def valid_login(login: str) -> bool:
    return bool(LOGIN_RE.fullmatch(login))


def clean_login(raw: str) -> str:
    login = norm_login(raw)
    if not valid_login(login):
        raise FormError("Логін: від 2 до 40 символів, без пробілів")
    return login


def new_password(password: str) -> str:
    if len(password) < 6:
        raise FormError("Пароль має бути щонайменше 6 символів")
    return password


def dedupe_logins(logins: list[tuple[int, str]]) -> dict[int, str]:
    """Migration helper: map user id -> normalised login, making colliding ones unique."""
    out: dict[int, str] = {}
    taken: set[str] = set()
    for uid, raw in sorted(logins):
        new = norm_login(raw) or f"user{uid}"
        if new in taken:
            new = f"{new}-{uid}"
        taken.add(new)
        out[uid] = new
    return out


class AuthResult:
    def __init__(
        self,
        user: User | None = None,
        error: str | None = None,
        status_code: int = 200,
        retry_after_seconds: int | None = None,
    ):
        self.user = user
        self.error = error
        self.status_code = status_code
        self.retry_after_seconds = retry_after_seconds

    @property
    def is_success(self) -> bool:
        return self.user is not None and self.status_code == 200


def authenticate_credentials(
    request: Request,
    login_str: str,
    password_str: str,
    db: Session,
) -> AuthResult:
    key = norm_login(login_str)
    ip = client_ip(request)
    wait = retry_after(ip, key)
    if wait:
        return AuthResult(
            error="Забагато невдалих спроб. Спробуйте пізніше.",
            status_code=429,
            retry_after_seconds=wait,
        )
    user = db.scalar(select(User).where(User.login == key))
    if not user or not check_pw(password_str, user.password_hash):
        record_failure(ip, key)
        record_audit(db, request, key or "?", "", "невдалий вхід")
        db.commit()
        return AuthResult(
            error="Неправильний логін або пароль",
            status_code=401,
        )
    if user.role == "store" and (not user.store or user.store.archived):
        record_failure(ip, key)
        record_audit(
            db, request, user.login, user.role, "невдалий вхід", "магазин в архіві"
        )
        db.commit()
        return AuthResult(
            error="Цей обліковий запис вимкнено. Зверніться до адміністратора.",
            status_code=403,
        )
    clear_failures(ip, key)
    record_audit(db, request, user.login, user.role, "вхід")
    db.commit()
    request.session.clear()
    request.session["uid"] = user.id
    return AuthResult(user=user, status_code=200)


def logout_user(request: Request, db: Session) -> None:
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user:
        record_audit(db, request, user.login, user.role, "вихід")
        db.commit()
    request.session.clear()


def change_admin_password(
    db: Session, user: User, new_pw: str, request: Request | None = None
) -> None:
    user.password_hash = hash_pw(new_pw)
    if request:
        record_audit(db, request, user.login, user.role, "змінено пароль адміністратора")
    db.commit()


# Interface contract: store user credential management (Stores -> Auth)


def create_store_user(
    db: Session, login: str, password: str, store_id: int
) -> User:
    """Store slice delegates user credential creation to auth."""
    account = User(
        login=norm_login(login),
        password_hash=hash_pw(password),
        role="store",
        store_id=store_id,
    )
    db.add(account)
    return account


def update_store_user_login(
    db: Session, store_id: int, new_login: str
) -> None:
    """Store slice delegates login renames to auth."""
    account = db.scalar(
        select(User).where(User.store_id == store_id, User.role == "store")
    )
    if account:
        account.login = norm_login(new_login)


def reset_store_user_password(
    db: Session, store_id: int, new_password: str
) -> User:
    """Store slice delegates password resets to auth."""
    account = db.scalar(
        select(User).where(User.store_id == store_id, User.role == "store")
    )
    if not account:
        raise HTTPException(
            status_code=404, detail="Обліковий запис магазину не знайдено."
        )
    account.password_hash = hash_pw(new_password)
    return account


def delete_store_user(db: Session, store_id: int) -> None:
    """Store slice delegates user deletion to auth."""
    db.execute(delete(User).where(User.store_id == store_id))


__all__ = [
    "AuthResult",
    "LOGIN_RE",
    "authenticate_credentials",
    "change_admin_password",
    "clean_login",
    "create_store_user",
    "dedupe_logins",
    "delete_store_user",
    "logout_user",
    "new_password",
    "norm_login",
    "reset_store_user_password",
    "update_store_user_login",
    "valid_login",
]
