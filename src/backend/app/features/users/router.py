"""User administration REST API endpoints."""

from fastapi import APIRouter, Depends, Request, status
from sqlmodel import Session

from app.core.database import get_db
from app.core.schemas import MutationDTO
from app.features.auth.dependencies import api_admin_required
from app.features.auth.models import User
from app.features.users.schemas import UserCreateDTO, UserDTO, UserUpdateDTO
from app.features.users.service import create_user, delete_user, list_users, update_user

router = APIRouter(tags=["Users"])


@router.get("/admin/users", response_model=list[UserDTO])
def api_list_users(
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> list[UserDTO]:
    return list_users(db)


@router.post(
    "/admin/users",
    response_model=UserDTO,
    status_code=status.HTTP_201_CREATED,
)
def api_create_user(
    payload: UserCreateDTO,
    request: Request,
    actor: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> UserDTO:
    return create_user(db, payload, actor, request)


@router.put("/admin/users/{uid}", response_model=UserDTO)
def api_update_user(
    uid: int,
    payload: UserUpdateDTO,
    request: Request,
    actor: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> UserDTO:
    return update_user(db, uid, payload, actor, request)


@router.delete("/admin/users/{uid}", response_model=MutationDTO)
def api_delete_user(
    uid: int,
    request: Request,
    actor: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> MutationDTO:
    user = db.get(User, uid)
    login = user.login if user else ""
    delete_user(db, uid, actor, request)
    return MutationDTO(id=uid, deleted=True, message=f"Користувача «{login}» видалено.")


__all__ = ["router"]
