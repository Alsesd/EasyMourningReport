"""Products and pricing REST API endpoints."""

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlmodel import Session

from app.core.database import get_db
from app.features.auth.dependencies import api_admin_required
from app.features.auth.models import User
from app.features.products.schemas import (
    ImportResultDTO,
    MutationDTO,
    ProductCreateDTO,
    ProductDTO,
    ProductUpdateDTO,
)
from app.features.products.service import (
    archive_or_delete_product,
    create_product,
    list_products,
    parse_products_excel,
    restore_product,
    update_product,
    update_product_price,
)

router = APIRouter(tags=["Products"])


@router.get("/admin/products", response_model=list[ProductDTO])
def api_list_products(
    period: str | None = None,
    _: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> list[ProductDTO]:
    return list_products(db, period)


@router.post(
    "/admin/products",
    response_model=ProductDTO,
    status_code=status.HTTP_201_CREATED,
)
def api_create_product(
    payload: ProductCreateDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> ProductDTO:
    return create_product(db, payload, user, request)


@router.post("/admin/products/import", response_model=ImportResultDTO)
async def api_import_products(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> ImportResultDTO:
    """Import an Excel workbook through the JSON API with a bounded upload."""
    max_import_bytes = 10 * 1024 * 1024
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=400, detail="Завантажте файл Excel у форматі .xlsx"
        )
    payload = await file.read(max_import_bytes + 1)
    if not payload or len(payload) > max_import_bytes:
        raise HTTPException(
            status_code=400, detail="Файл порожній або перевищує 10 МБ"
        )
    message = parse_products_excel(payload, db, user, request)
    return ImportResultDTO(message=message)


@router.put("/admin/products/{pid}/price", response_model=ProductDTO)
def api_update_product_price(
    pid: int,
    payload: dict,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> ProductDTO:
    return update_product_price(db, pid, payload, user, request)


@router.put("/admin/products/{pid}", response_model=ProductDTO)
def api_update_product(
    pid: int,
    payload: ProductUpdateDTO,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> ProductDTO:
    return update_product(db, pid, payload, user, request)


@router.delete("/admin/products/{pid}", response_model=MutationDTO)
def api_delete_product(
    pid: int,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> MutationDTO:
    return archive_or_delete_product(db, pid, user, request)


@router.post("/admin/products/{pid}/restore", response_model=ProductDTO)
def api_restore_product(
    pid: int,
    request: Request,
    user: User = Depends(api_admin_required),
    db: Session = Depends(get_db),
) -> ProductDTO:
    return restore_product(db, pid, user, request)


__all__ = ["router"]
