"""Authentication endpoints: login and logout."""

from fastapi import APIRouter, Depends, Form, Request
from app.core.ratelimit import clear_failures, record_failure, retry_after
from app.core.security import check_pw, client_ip
from app.core.ui import render
from app.db.models.user import User
from app.db.repositories.audit import audit
from app.db.session import get_db
from app.services.pricing import norm_login
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session


router = APIRouter()


@router.get("/login")
def login_form(request: Request):
    return render(request, "login.html", {"error": None})


@router.post("/login")
def login_post(
    request: Request,
    login: str = Form(),
    password: str = Form(),
    db: Session = Depends(get_db),
):
    key = norm_login(login)
    ip = client_ip(request)
    wait = retry_after(ip, key)
    if wait:
        return Response(
            "Забагато невдалих спроб. Спробуйте пізніше.",
            status_code=429,
            headers={"Retry-After": str(wait), "Cache-Control": "no-store"},
        )
    user = db.scalar(select(User).where(User.login == key))
    if not user or not check_pw(password, user.password_hash):
        record_failure(ip, key)
        audit(db, request, key or "?", "", "невдалий вхід")
        db.commit()
        return render(
            request,
            "login.html",
            {"error": "Неправильний логін або пароль"},
            status_code=401,
        )
    if user.role == "store" and (not user.store or user.store.archived):
        record_failure(ip, key)
        audit(db, request, user.login, user.role, "невдалий вхід", "магазин в архіві")
        db.commit()
        return render(
            request,
            "login.html",
            {"error": "Цей обліковий запис вимкнено. Зверніться до адміністратора."},
            status_code=403,
        )
    clear_failures(ip, key)
    audit(db, request, user.login, user.role, "вхід")
    db.commit()
    request.session.clear()
    request.session["uid"] = user.id
    return RedirectResponse("/", 303)


@router.post("/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user:
        audit(db, request, user.login, user.role, "вихід")
        db.commit()
    request.session.clear()
    return RedirectResponse("/login", 303)
