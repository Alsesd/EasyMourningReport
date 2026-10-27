"""Shared test harness and fixtures for E2E tests (Tiers 1-4).

Provides isolated database instances, authenticated HTTP clients,
and helper functions for opaque-box testing of the EasyMourningReport system.
"""

from __future__ import annotations

import io
import shutil
import tempfile
from collections.abc import Generator
from pathlib import Path
from typing import Any

import openpyxl
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine

import app.core.backup as backup_service
from app.core.database import Base, get_db
from app.core.ratelimit import _fails
from app.core.security import hash_pw
from app.features.auth.models import User
from app.features.products.models import Product, ProductPrice
from app.features.products.service import BASE_PERIOD
from app.features.stores.models import Store
from app.main import app


@pytest.fixture
def e2e_env(monkeypatch: pytest.MonkeyPatch) -> Generator[dict[str, Any], None, None]:
    """Provide an isolated database, temp storage, and default seed data."""
    temp_dir = tempfile.mkdtemp(prefix="emr-e2e-")
    temp_path = Path(temp_dir)
    db_file = temp_path / "reports.db"
    backup_dir = temp_path / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("LEGKYI_DATA_DIR", str(temp_path))
    monkeypatch.setenv("LEGKYI_BACKUPS_DIR", str(backup_dir))
    monkeypatch.setattr(backup_service, "BACKUP_DIR", backup_dir)

    engine = create_engine(
        f"sqlite:///{db_file.as_posix()}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    monkeypatch.setattr(backup_service, "engine", engine)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)

    def _override_get_db() -> Generator[Session, None, None]:
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = _override_get_db

    # Clear throttles
    _fails.clear()

    # Seed baseline records
    with session_factory() as db:
        admin = User(
            login="e2e_admin",
            password_hash=hash_pw("AdminPass123!"),
            role="admin",
        )
        store = Store(name="E2E Store 1", archived=False)
        db.add_all([admin, store])
        db.flush()

        store_user = User(
            login="e2e_store1",
            password_hash=hash_pw("StorePass123!"),
            role="store",
            store_id=store.id,
        )
        product = Product(
            name="E2E Default Bread",
            price_cents=200,
            active=True,
            archived=False,
        )
        db.add_all([store_user, product])
        db.flush()

        db.add(ProductPrice(product_id=product.id, period=BASE_PERIOD, price_cents=200))
        db.commit()

        env_context = {
            "engine": engine,
            "session_factory": session_factory,
            "admin_id": admin.id,
            "admin_login": "e2e_admin",
            "admin_password": "AdminPass123!",
            "store_id": store.id,
            "store_name": "E2E Store 1",
            "store_login": "e2e_store1",
            "store_password": "StorePass123!",
            "product_id": product.id,
            "product_name": "E2E Default Bread",
            "product_price_cents": 200,
            "db_path": db_file,
            "temp_path": temp_path,
        }

    yield env_context

    app.dependency_overrides.clear()
    engine.dispose()
    _fails.clear()
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def anon_client(e2e_env: dict[str, Any]) -> Generator[TestClient, None, None]:
    """Return an unauthenticated client with origin set and isolated environment."""
    client = TestClient(
        app,
        base_url="http://testserver",
        headers={"origin": "http://testserver"},
        follow_redirects=False,
    )
    yield client
    client.close()


@pytest.fixture
def admin_client(e2e_env: dict[str, Any]) -> Generator[TestClient, None, None]:
    """Return an authenticated administrator client."""
    client = TestClient(
        app,
        base_url="http://testserver",
        headers={"origin": "http://testserver"},
        follow_redirects=False,
    )
    response = client.post(
        "/api/v1/auth/login",
        json={
            "login": e2e_env["admin_login"],
            "password": e2e_env["admin_password"],
        },
    )
    assert response.status_code == 200, f"Admin login failed: {response.text}"
    yield client
    client.close()


@pytest.fixture
def store_client(e2e_env: dict[str, Any]) -> Generator[TestClient, None, None]:
    """Return an authenticated store client."""
    client = TestClient(
        app,
        base_url="http://testserver",
        headers={"origin": "http://testserver"},
        follow_redirects=False,
    )
    response = client.post(
        "/api/v1/auth/login",
        json={
            "login": e2e_env["store_login"],
            "password": e2e_env["store_password"],
        },
    )
    assert response.status_code == 200, f"Store login failed: {response.text}"
    yield client
    client.close()


def make_excel_workbook(rows: list[tuple[str, str | float | int]]) -> bytes:
    """Generate an Excel workbook binary stream for catalog import tests."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Товари"
    ws.append(["Назва", "Ціна"])
    for name, price in rows:
        ws.append([name, price])
    stream = io.BytesIO()
    wb.save(stream)
    return stream.getvalue()
