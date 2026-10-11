"""FastAPI HTTP integration tests using Starlette's TestClient."""

import os
import tempfile

# Keep import-time secret/data initialization out of the user's working directory.
os.environ.setdefault(
    "LEGKYI_DATA_DIR", tempfile.mkdtemp(prefix="legkyi-zvit-pytest-")
)
os.environ.setdefault("SECRET_KEY", "pytest-only-secret-key-not-for-production")

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app, raise_server_exceptions=False)


def test_manifest_is_valid_and_uses_new_pwa_icon():
    response = client.get("/manifest.webmanifest")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/manifest+json")
    manifest = response.json()
    assert manifest["name"] == "Легкий звіт"
    assert manifest["icons"][0]["src"] == "/static/icon.svg"


def test_new_pwa_icon_is_served_as_svg():
    response = client.get("/static/icon.svg")

    assert response.status_code == 200
    assert "image/svg+xml" in response.headers["content-type"]
    assert "<svg" in response.text
    assert "Легкий звіт" in response.text


def test_apple_touch_icon_is_a_valid_png():
    response = client.get("/static/apple-touch-icon.png")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    assert response.content[:8] == bytes([137, 80, 78, 71, 13, 10, 26, 10])


def test_service_worker_uses_a_new_cache_version():
    response = client.get("/sw.js")

    assert response.status_code == 200
    assert "legkyi-zvit-v4" in response.text
    assert "/static/icon.svg" in response.text


def test_login_page_is_rendered():
    response = client.get("/login")

    assert response.status_code == 200
    assert 'name="login"' in response.text
    assert 'name="password"' in response.text


def test_anonymous_user_is_redirected_from_private_pages():
    for path in ("/", "/report", "/admin"):
        response = client.get(path, follow_redirects=False)
        assert response.status_code == 303
        assert response.headers["location"] == "/login"


def test_post_without_same_origin_header_is_rejected():
    response = client.post(
        "/login",
        data={"login": "admin", "password": "incorrect"},
        follow_redirects=False,
    )

    assert response.status_code == 403


def test_cross_origin_post_is_rejected():
    response = client.post(
        "/login",
        headers={"Origin": "https://attacker.example"},
        data={"login": "admin", "password": "incorrect"},
        follow_redirects=False,
    )

    assert response.status_code == 403


def test_offline_page_is_available():
    response = client.get("/offline")

    assert response.status_code == 200
    assert "offline" in response.text.lower() or "звіт" in response.text.lower()


def test_missing_route_uses_html_error_page():
    response = client.get("/this-route-does-not-exist")

    assert response.status_code == 404
    assert "text/html" in response.headers["content-type"]
    assert "404" in response.text
