"""Authentication and session REST API endpoints."""

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlmodel import Session

from app.core.database import get_db
from app.core.ui import current_period
from app.features.auth.dependencies import (
    api_admin_required,
    api_user_required,
)
from app.features.auth.models import User
from app.features.auth.schemas import (
    LoginDTO,
    MessageDTO,
    PasswordDTO,
    SessionDTO,
)
from app.features.auth.service import (
    authenticate_credentials,
    change_admin_password,
    logout_user,
)

router = APIRouter(tags=["Auth"])
public_router = APIRouter(tags=["Auth"])


@public_router.post("/login")
def login_form(
    request: Request,
    login: str = Form(),
    password: str = Form(),
    db: Session = Depends(get_db),
):
    """Authenticate the server-rendered login form and redirect into the SPA."""
    result = authenticate_credentials(request, login, password, db)
    if not result.is_success:
        headers = {}
        if result.retry_after_seconds:
            headers["Retry-After"] = str(result.retry_after_seconds)
            headers["Cache-Control"] = "no-store"
        return Response(
            result.error, status_code=result.status_code, headers=headers
        )
    return RedirectResponse("/", 303)


@public_router.post("/logout")
def logout_form(request: Request, db: Session = Depends(get_db)):
    logout_user(request, db)
    return RedirectResponse("/login", 303)


@router.get("/session", response_model=SessionDTO)
def get_session(user: User = Depends(api_user_required)) -> SessionDTO:
    return SessionDTO(
        login=user.login,
        role=user.role,
        store_id=user.store_id,
        store_name=user.store.name if user.store else None,
        period=current_period(),
    )


@router.post("/auth/login", response_model=SessionDTO)
def api_login(
    request: Request,
    payload: LoginDTO,
    db: Session = Depends(get_db),
) -> SessionDTO:
    result = authenticate_credentials(
        request, payload.login, payload.password, db
    )
    if not result.is_success:
        headers = {}
        if result.retry_after_seconds:
            headers["Retry-After"] = str(result.retry_after_seconds)
            headers["Cache-Control"] = "no-store"
        raise HTTPException(
            status_code=result.status_code,
            detail=result.error,
            headers=headers,
        )
    user = result.user
    return SessionDTO(
        login=user.login,
        role=user.role,
        store_id=user.store_id,
        store_name=user.store.name if user.store else None,
        period=current_period(),
    )


@router.post("/auth/logout", response_model=MessageDTO)
def api_logout(
    request: Request,
    db: Session = Depends(get_db),
) -> MessageDTO:
    logout_user(request, db)
    return MessageDTO(message="Ви вийшли із системи.")


@router.put("/admin/password", response_model=MessageDTO)
def update_admin_password(
    payload: PasswordDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> MessageDTO:
    if len(payload.password) < 6:
        raise HTTPException(
            status_code=422, detail="Пароль має бути щонайменше 6 символів"
        )
    change_admin_password(db, user, payload.password, request)
    return MessageDTO(message="Ваш пароль змінено.")


__all__ = ["public_router", "router"]
