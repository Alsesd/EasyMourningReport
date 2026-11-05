"""JSON sign-in, sign-out, current session and own-password endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session

from app.core.dependencies import new_password
from app.core.periods import current_period
from app.core.schemas import MessageDTO, PasswordDTO
from app.core.security import hash_pw
from app.db.session import get_db
from app.platform.accounts.access import Principal, current_principal, principal_for
from app.platform.accounts.auth import authenticate_credentials, logout_user
from app.platform.accounts.schemas import LoginDTO, OrganisationRefDTO, SessionDTO
from app.platform.audit.service import audit
from app.platform.registry import get_registry

router = APIRouter(tags=["Session"])


def session_dto(principal: Principal) -> SessionDTO:
    user = principal.user
    return SessionDTO(
        user_id=user.id,
        login=user.login,
        full_name=user.full_name,
        organisation=(
            OrganisationRefDTO(id=user.organisation.id, name=user.organisation.name)
            if user.organisation
            else None
        ),
        roles=sorted(r.name for r in user.roles),
        permissions=sorted(principal.permissions),
        modules=[m.name for m in get_registry()],
        period=current_period(),
    )


@router.get("/session", response_model=SessionDTO)
def get_session(principal: Principal = Depends(current_principal)) -> SessionDTO:
    return session_dto(principal)


@router.post("/auth/login", response_model=SessionDTO)
def api_login(request: Request, payload: LoginDTO, db: Session = Depends(get_db)) -> SessionDTO:
    result = authenticate_credentials(request, payload.login, payload.password, db)
    if not result.is_success:
        headers = {}
        if result.retry_after_seconds:
            headers["Retry-After"] = str(result.retry_after_seconds)
            headers["Cache-Control"] = "no-store"
        raise HTTPException(status_code=result.status_code, detail=result.error, headers=headers)
    return session_dto(principal_for(result.user))


@router.post("/auth/logout", response_model=MessageDTO)
def api_logout(request: Request, db: Session = Depends(get_db)) -> MessageDTO:
    logout_user(request, db)
    return MessageDTO(message="Ви вийшли із системи.")


@router.put("/me/password", response_model=MessageDTO)
def change_own_password(
    payload: PasswordDTO,
    request: Request,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
) -> MessageDTO:
    user = db.merge(principal.user)
    user.password_hash = hash_pw(new_password(payload.password))
    audit(db, request, principal.login, principal.role_label, "змінено власний пароль")
    db.commit()
    return MessageDTO(message="Ваш пароль змінено.")
