from fastapi import APIRouter, Depends, Form, Request
from app.core.paths import asset_dir
from app.core.ratelimit import clear_failures, record_failure, retry_after
from app.core.security import check_pw, client_ip
from app.core.ui import render
from app.db.models.user import User
from app.db.repositories.audit import audit
from app.db.session import get_db
from app.services.pricing import norm_login
from fastapi.responses import FileResponse, RedirectResponse, Response
from sqlmodel import select
from sqlmodel import Session


router = APIRouter()


@router.get("/login")
def login_form(request: Request):
    return render(request, "login.html", {"error": None})


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
    if user.role == "store" and (not user.store or user.store.archived):
        record_failure(ip, key)
        audit(db, request, user.login, user.role, "невдалий вхід", "магазин в архіві")
        db.commit()
        return AuthResult(
            error="Цей обліковий запис вимкнено. Зверніться до адміністратора.",
            status_code=403,
        )
    clear_failures(ip, key)
    audit(db, request, user.login, user.role, "вхід")
    db.commit()
    request.session.clear()
    request.session["uid"] = user.id
    return AuthResult(user=user, status_code=200)


def logout_user(request: Request, db: Session) -> None:
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user:
        audit(db, request, user.login, user.role, "вихід")
        db.commit()
    request.session.clear()


@router.post("/login")
def login_post(
    request: Request,
    login: str = Form(),
    password: str = Form(),
    db: Session = Depends(get_db),
):
    result = authenticate_credentials(request, login, password, db)
    if not result.is_success:
        if result.status_code == 429:
            return Response(
                result.error,
                status_code=429,
                headers={"Retry-After": str(result.retry_after_seconds), "Cache-Control": "no-store"},
            )
        return render(
            request,
            "login.html",
            {"error": result.error},
            status_code=result.status_code,
        )
    return RedirectResponse("/", 303)


@router.post("/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    logout_user(request, db)
    return RedirectResponse("/login", 303)
