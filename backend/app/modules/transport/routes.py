"""Transport-order endpoints. Placeholder until the orders model is designed."""

from fastapi import APIRouter, Depends

from app.modules.transport.permissions import CREATE, MANAGE, VIEW_ALL
from app.modules.transport.schemas import TransportStatusDTO
from app.platform.accounts.access import Principal, require

router = APIRouter(prefix="/transport", tags=["Transport"])


@router.get("/status", response_model=TransportStatusDTO)
def module_status(_: Principal = Depends(require(CREATE, VIEW_ALL, MANAGE))) -> TransportStatusDTO:
    """Lets the client confirm the module is installed and the caller may use it."""
    return TransportStatusDTO(ready=False, message="Модуль замовлення транспорту ще в розробці.")
