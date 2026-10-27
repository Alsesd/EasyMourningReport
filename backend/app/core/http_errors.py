"""Register consistent JSON API errors and readable HTML fallback errors."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.errors import FormError
from app.core.web import done, render, safe_referer


def _is_api_request(request: Request) -> bool:
    return request.url.path == "/api/v1" or request.url.path.startswith("/api/v1/")


def form_error(request: Request, exc: FormError):
    """Send form validation errors to API consumers as JSON and others as flash state."""
    if _is_api_request(request):
        return JSONResponse(
            {"detail": exc.message, "code": "validation_error"}, status_code=422
        )
    return done(request, exc.to or safe_referer(request) or "/", exc.message, "err")


def invalid_form(request: Request, exc: RequestValidationError):
    """Normalize FastAPI request validation errors for both API and HTML clients."""
    if _is_api_request(request):
        errors = [
            {
                "loc": [str(part) for part in error.get("loc", ())],
                "msg": error.get("msg", "Invalid value"),
                "type": error.get("type", "value_error"),
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            {"detail": "Некоректні дані запиту.", "errors": errors},
            status_code=422,
        )
    if request.method == "POST":
        return done(
            request, safe_referer(request) or "/", "Заповніть усі поля форми.", "err"
        )
    return render(
        request,
        "error.html",
        {"code": 400, "message": "Некоректний запит"},
        status_code=400,
    )


def http_error(request: Request, exc: StarletteHTTPException):
    """Preserve redirects and return a consistent API response envelope."""
    if _is_api_request(request):
        return JSONResponse(
            {"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers
        )
    location = (exc.headers or {}).get("Location")
    if location and 300 <= exc.status_code < 400:
        return RedirectResponse(location, exc.status_code)
    return render(
        request,
        "error.html",
        {"code": exc.status_code, "message": exc.detail},
        status_code=exc.status_code,
    )


def register_exception_handlers(application: FastAPI) -> None:
    """Install the project's exception handlers on the composed FastAPI instance."""
    application.add_exception_handler(FormError, form_error)
    application.add_exception_handler(RequestValidationError, invalid_form)
    application.add_exception_handler(StarletteHTTPException, http_error)
