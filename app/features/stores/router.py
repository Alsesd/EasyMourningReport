"""Stores and store accounts REST API endpoints."""

from fastapi import APIRouter, Depends, Request, status
from sqlmodel import Session

from app.core.database import get_db
from app.features.auth.dependencies import api_admin_required
from app.features.auth.models import User
from app.features.auth.schemas import MessageDTO, StorePasswordDTO
from app.features.stores.schemas import (
    MutationDTO,
    StoreCreateDTO,
    StoreDTO,
    StoreUpdateDTO,
)
from app.features.stores.service import (
    archive_or_delete_store,
    create_store,
    list_stores,
    reset_store_password_service,
    restore_store,
    update_store,
)

router = APIRouter(tags=["Stores"])


@router.get("/admin/stores", response_model=list[StoreDTO])
def api_list_stores(
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> list[StoreDTO]:
    return list_stores(db)


@router.post(
    "/admin/stores",
    response_model=StoreDTO,
    status_code=status.HTTP_201_CREATED,
)
def api_create_store(
    payload: StoreCreateDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> StoreDTO:
    return create_store(db, payload, user, request)


@router.put("/admin/stores/{sid}", response_model=StoreDTO)
def api_update_store(
    sid: int,
    payload: StoreUpdateDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> StoreDTO:
    return update_store(db, sid, payload, user, request)


@router.delete("/admin/stores/{sid}", response_model=MutationDTO)
def api_delete_store(
    sid: int,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> MutationDTO:
    return archive_or_delete_store(db, sid, user, request)


@router.post("/admin/stores/{sid}/restore", response_model=StoreDTO)
def api_restore_store(
    sid: int,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> StoreDTO:
    return restore_store(db, sid, user, request)


@router.put("/admin/stores/{sid}/password", response_model=MessageDTO)
def api_reset_store_password(
    sid: int,
    payload: StorePasswordDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> MessageDTO:
    return reset_store_password_service(db, sid, payload, user, request)


__all__ = ["router"]
