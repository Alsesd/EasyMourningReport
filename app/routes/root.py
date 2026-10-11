"""Root endpoint: role-based home redirection."""

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse

from app.core.dependencies import user_required
from app.db.models.user import User

router = APIRouter()


@router.get("/")
def index(user: User = Depends(user_required)):
    return RedirectResponse("/admin" if user.role == "admin" else "/report", 303)
