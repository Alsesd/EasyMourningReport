"""Consistent error responses: JSON for the API, a minimal page for anything else."""

from html import escape

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.errors import FormError


def _is_api_request(request: Request) -> bool:
    return request.url.path == "/api/v1" or request.url.path.startswith("/api/v1/")


def _error_page(status_code: int, message: str) -> HTMLResponse:
    body = (
        '<!doctype html><html lang="uk"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>Помилка {status_code} · Легкий звіт</title>"
        '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:1rem">'
        f"<h1>Помилка {status_code}</h1><p>{escape(message)}</p><p><a href=\"/\">На головну</a></p></body></html>"
    )
    return HTMLResponse(body, status_code=status_code)


def form_error(request: Request, exc: FormError):
    return JSONResponse({"detail": exc.message, "code": "validation_error"}, status_code=422)


def invalid_request(request: Request, exc: RequestValidationError):
    if not _is_api_request(request):
        return _error_page(400, "Некоректний запит")
    errors = [
        {
            "loc": [str(part) for part in error.get("loc", ())],
            "msg": error.get("msg", "Invalid value"),
            "type": error.get("type", "value_error"),
        }
        for error in exc.errors()
    ]
    return JSONResponse({"detail": "Некоректні дані запиту.", "errors": errors}, status_code=422)


def http_error(request: Request, exc: StarletteHTTPException):
    if _is_api_request(request):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
    return _error_page(exc.status_code, str(exc.detail))


def register_exception_handlers(application: FastAPI) -> None:
    application.add_exception_handler(FormError, form_error)
    application.add_exception_handler(RequestValidationError, invalid_request)
    application.add_exception_handler(StarletteHTTPException, http_error)
