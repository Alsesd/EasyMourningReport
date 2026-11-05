"""Credential checks with rate limiting and audit entries, used by the JSON sign-in endpoints."""

from fastapi import Request
from sqlmodel import Session, select

from app.core.ratelimit import clear_failures, record_failure, retry_after
from app.core.security import check_pw, client_ip
from app.core.text import norm_login
from app.platform.accounts.access import can_sign_in, principal_for
from app.platform.accounts.models import User
from app.platform.audit.service import audit


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
        audit(db, request, key or "?", "", "невдалий вхід")
        db.commit()
        return AuthResult(
            error="Неправильний логін або пароль",
            status_code=401,
        )
    if not can_sign_in(user):
        record_failure(ip, key)
        reason = "обліковий запис вимкнено" if not user.active else "організація в архіві"
        audit(db, request, user.login, principal_for(user).role_label, "невдалий вхід", reason)
        db.commit()
        return AuthResult(
            error="Цей обліковий запис вимкнено. Зверніться до адміністратора.",
            status_code=403,
        )
    clear_failures(ip, key)
    audit(db, request, user.login, principal_for(user).role_label, "вхід")
    db.commit()
    request.session.clear()
    request.session["uid"] = user.id
    return AuthResult(user=user, status_code=200)


def logout_user(request: Request, db: Session) -> None:
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user:
        audit(db, request, user.login, principal_for(user).role_label, "вихід")
        db.commit()
    request.session.clear()
