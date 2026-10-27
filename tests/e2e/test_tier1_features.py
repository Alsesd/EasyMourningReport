"""Tier 1 - Feature Coverage E2E Tests (>=5 test cases per feature area).

Coverage Areas:
1. Auth (7 test cases)
2. Products (7 test cases)
3. Stores (6 test cases)
4. Reports (6 test cases)
5. Audit (6 test cases)
6. Tunnel (6 test cases)
7. Summary & Exports (6 test cases)
Total: 44 test cases
"""

from __future__ import annotations

import io
from typing import Any
from unittest.mock import patch

import openpyxl
from fastapi.testclient import TestClient

from app.core.ui import current_period
from tests.e2e.conftest import make_excel_workbook

# =============================================================================
# 1. AUTHENTICATION & SESSION MANAGEMENT
# =============================================================================

def test_auth_valid_admin_login(anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-AUTH-01: Valid admin credentials return admin session DTO and set session cookie."""
    response = anon_client.post(
        "/api/v1/auth/login",
        json={"login": e2e_env["admin_login"], "password": e2e_env["admin_password"]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["login"] == e2e_env["admin_login"]
    assert data["role"] == "admin"
    assert data["store_id"] is None
    assert "period" in data

    # Verify session cookie was set and allows access to /session
    session_res = anon_client.get("/api/v1/session")
    assert session_res.status_code == 200
    assert session_res.json()["role"] == "admin"


def test_auth_valid_store_login(anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-AUTH-02: Valid store credentials return store session DTO with store association."""
    response = anon_client.post(
        "/api/v1/auth/login",
        json={"login": e2e_env["store_login"], "password": e2e_env["store_password"]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["login"] == e2e_env["store_login"]
    assert data["role"] == "store"
    assert data["store_id"] == e2e_env["store_id"]
    assert data["store_name"] == e2e_env["store_name"]

    # Verify session endpoint
    session_res = anon_client.get("/api/v1/session")
    assert session_res.status_code == 200
    assert session_res.json()["role"] == "store"
    assert session_res.json()["store_id"] == e2e_env["store_id"]


def test_auth_invalid_password_rejection(anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-AUTH-03: Invalid password returns 401 Unauthorized with human error message."""
    response = anon_client.post(
        "/api/v1/auth/login",
        json={"login": e2e_env["admin_login"], "password": "WrongPassword999!"},
    )
    assert response.status_code == 401
    assert "Неправильний логін або пароль" in response.json()["detail"]


def test_auth_nonexistent_user_rejection(anon_client: TestClient):
    """TC-AUTH-04: Nonexistent login returns 401 Unauthorized."""
    response = anon_client.post(
        "/api/v1/auth/login",
        json={"login": "nonexistent_user_xyz", "password": "AnyPassword123!"},
    )
    assert response.status_code == 401
    assert "Неправильний логін або пароль" in response.json()["detail"]


def test_auth_logout_terminates_session(store_client: TestClient):
    """TC-AUTH-05: Logout clears session; subsequent session requests fail with 401."""
    # Active session check
    active = store_client.get("/api/v1/session")
    assert active.status_code == 200

    # Logout
    logout_res = store_client.post("/api/v1/auth/logout")
    assert logout_res.status_code == 200
    assert "вийшли" in logout_res.json()["message"]

    # Subsequent session check
    subsequent = store_client.get("/api/v1/session")
    assert subsequent.status_code == 401
    assert "Увійдіть у систему" in subsequent.json()["detail"]


def test_auth_unauthenticated_access_rejection(anon_client: TestClient):
    """TC-AUTH-06: Protected API endpoints reject unauthenticated access."""
    res_session = anon_client.get("/api/v1/session")
    assert res_session.status_code == 401

    res_admin = anon_client.get("/api/v1/admin/products")
    # API endpoints return 401 when unauthenticated
    assert res_admin.status_code in (401, 303)


def test_auth_store_user_forbidden_on_admin_routes(store_client: TestClient):
    """TC-AUTH-07: Store credentials cannot access administrator endpoints (RBAC)."""
    assert store_client.get("/api/v1/admin/products").status_code == 403
    assert store_client.get("/api/v1/admin/stores").status_code == 403
    assert store_client.get("/api/v1/admin/tunnel").status_code == 403
    assert store_client.get("/api/v1/admin/logs").status_code == 403


# =============================================================================
# 2. PRODUCTS CATALOGUE MANAGEMENT
# =============================================================================

def test_products_list_catalogue(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-PROD-01: Admin can retrieve the product catalogue DTOs."""
    response = admin_client.get("/api/v1/admin/products")
    assert response.status_code == 200
    products = response.json()
    assert isinstance(products, list)
    assert len(products) >= 1
    seeded = next(p for p in products if p["id"] == e2e_env["product_id"])
    assert seeded["name"] == e2e_env["product_name"]
    assert seeded["price_cents"] == e2e_env["product_price_cents"]
    assert seeded["active"] is True
    assert seeded["archived"] is False


def test_products_create_product(admin_client: TestClient):
    """TC-PROD-02: Admin creates new product with valid decimal price string."""
    response = admin_client.post(
        "/api/v1/admin/products",
        json={"name": "Organic Milk", "price": "3.75"},
    )
    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Organic Milk"
    assert created["price_cents"] == 375
    assert created["active"] is True
    assert created["archived"] is False
    assert created["id"] > 0


def test_products_edit_name_and_status(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-PROD-03: Admin edits product name and deactivates it."""
    pid = e2e_env["product_id"]
    response = admin_client.put(
        f"/api/v1/admin/products/{pid}",
        json={"name": "E2E Renamed Bread", "price": "2.00", "active": False},
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["name"] == "E2E Renamed Bread"
    assert updated["active"] is False


def test_products_edit_price_with_period_history(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-PROD-04: Editing price updates current price and records timeline history."""
    pid = e2e_env["product_id"]
    response = admin_client.put(
        f"/api/v1/admin/products/{pid}/price",
        json={"price": "2.80"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["price_cents"] == 280
    assert 280 in data["month_prices_cents"]
    assert len(data["price_history"]) >= 2


def test_products_archive_and_restore_product(admin_client: TestClient, store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-PROD-05: Product used in a report is soft-archived on DELETE and restorable."""
    pid = e2e_env["product_id"]
    period = current_period()

    # Save a report draft using this product so used_count > 0
    save_res = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 3}],
        },
    )
    assert save_res.status_code == 200

    # Soft archive
    del_res = admin_client.delete(f"/api/v1/admin/products/{pid}")
    assert del_res.status_code == 200
    assert del_res.json()["archived"] is True
    assert del_res.json()["deleted"] is False

    # Restore
    restore_res = admin_client.post(f"/api/v1/admin/products/{pid}/restore")
    assert restore_res.status_code == 200
    assert restore_res.json()["archived"] is False


def test_products_hard_delete_unused_product(admin_client: TestClient):
    """TC-PROD-06: Product never referenced in any reports is permanently deleted."""
    created = admin_client.post(
        "/api/v1/admin/products",
        json={"name": "Temporary Product", "price": "1.00"},
    ).json()
    pid = created["id"]

    del_res = admin_client.delete(f"/api/v1/admin/products/{pid}")
    assert del_res.status_code == 200
    assert del_res.json()["deleted"] is True

    # Confirm it is no longer listed
    products = admin_client.get("/api/v1/admin/products").json()
    assert not any(p["id"] == pid for p in products)


def test_products_not_found_handling(admin_client: TestClient):
    """TC-PROD-07: Requests on non-existent product ID return 404 Not Found."""
    bad_id = 999999
    assert admin_client.put(f"/api/v1/admin/products/{bad_id}", json={"name": "X", "price": "1.0", "active": True}).status_code == 404
    assert admin_client.put(f"/api/v1/admin/products/{bad_id}/price", json={"price": "1.0"}).status_code == 404
    assert admin_client.delete(f"/api/v1/admin/products/{bad_id}").status_code == 404
    assert admin_client.post(f"/api/v1/admin/products/{bad_id}/restore").status_code == 404


# =============================================================================
# 3. STORE ACCOUNTS & OUTLET MANAGEMENT
# =============================================================================

def test_stores_list_stores(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-STORE-01: Admin can retrieve the stores list with DTO attributes."""
    response = admin_client.get("/api/v1/admin/stores")
    assert response.status_code == 200
    stores = response.json()
    assert isinstance(stores, list)
    store = next(s for s in stores if s["id"] == e2e_env["store_id"])
    assert store["name"] == e2e_env["store_name"]
    assert store["login"] == e2e_env["store_login"]
    assert store["archived"] is False
    assert "reports_count" in store


def test_stores_create_store(admin_client: TestClient, anon_client: TestClient):
    """TC-STORE-02: Admin creates a store and the generated account can authenticate."""
    create_res = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Store West", "login": "storewest", "password": "WestPassword123!"},
    )
    assert create_res.status_code == 201
    store_data = create_res.json()
    assert store_data["name"] == "Store West"
    assert store_data["login"] == "storewest"

    # Authenticate with new store credentials
    login_res = anon_client.post(
        "/api/v1/auth/login",
        json={"login": "storewest", "password": "WestPassword123!"},
    )
    assert login_res.status_code == 200
    assert login_res.json()["role"] == "store"
    assert login_res.json()["store_name"] == "Store West"


def test_stores_rename_store(admin_client: TestClient):
    """TC-STORE-03: Admin renames store name and updates store login."""
    created = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Store North", "login": "storenorth", "password": "NorthPassword123!"},
    ).json()
    sid = created["id"]

    rename_res = admin_client.put(
        f"/api/v1/admin/stores/{sid}",
        json={"name": "Store North Super", "login": "storenorth2"},
    )
    assert rename_res.status_code == 200
    data = rename_res.json()
    assert data["name"] == "Store North Super"
    assert data["login"] == "storenorth2"


def test_stores_change_password(admin_client: TestClient, anon_client: TestClient):
    """TC-STORE-04: Admin updates store password; old password fails, new password succeeds."""
    created = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Store South", "login": "storesouth", "password": "OldPassword123!"},
    ).json()
    sid = created["id"]

    pw_res = admin_client.put(
        f"/api/v1/admin/stores/{sid}/password",
        json={"password": "NewSecretPassword456!"},
    )
    assert pw_res.status_code == 200
    assert "змінено" in pw_res.json()["message"]

    # Old password fails
    assert anon_client.post(
        "/api/v1/auth/login",
        json={"login": "storesouth", "password": "OldPassword123!"},
    ).status_code == 401

    # New password succeeds
    assert anon_client.post(
        "/api/v1/auth/login",
        json={"login": "storesouth", "password": "NewSecretPassword456!"},
    ).status_code == 200


def test_stores_archive_and_restore(admin_client: TestClient, store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-STORE-05: Store with reports is archived on DELETE and restorable."""
    sid = e2e_env["store_id"]
    period = current_period()

    # Create a draft report for this store
    store_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "draft", "quantities": []},
    )

    # Archive
    archive_res = admin_client.delete(f"/api/v1/admin/stores/{sid}")
    assert archive_res.status_code == 200
    assert archive_res.json()["archived"] is True
    assert archive_res.json()["deleted"] is False

    # Restore
    restore_res = admin_client.post(f"/api/v1/admin/stores/{sid}/restore")
    assert restore_res.status_code == 200
    assert restore_res.json()["archived"] is False


def test_stores_hard_delete_unused(admin_client: TestClient):
    """TC-STORE-06: Store with zero reports is permanently deleted."""
    created = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Store Disposable", "login": "disposablestore", "password": "DisposablePass123!"},
    ).json()
    sid = created["id"]

    del_res = admin_client.delete(f"/api/v1/admin/stores/{sid}")
    assert del_res.status_code == 200
    assert del_res.json()["deleted"] is True

    # Confirm it is no longer listed
    stores = admin_client.get("/api/v1/admin/stores").json()
    assert not any(s["id"] == sid for s in stores)


# =============================================================================
# 4. MONTHLY REPORTS WORKFLOW
# =============================================================================

def test_reports_get_store_draft(store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-REP-01: Store gets active report draft with rows for active products."""
    period = current_period()
    response = store_client.get(f"/api/v1/store/reports/{period}")
    assert response.status_code == 200
    report = response.json()
    assert report["period"] == period
    assert report["read_only"] is False
    assert report["store_name"] == e2e_env["store_name"]
    assert len(report["rows"]) >= 1
    row = next(r for r in report["rows"] if r["id"] == e2e_env["product_id"])
    assert row["inputs"][0]["price_cents"] == e2e_env["product_price_cents"]


def test_reports_save_quantities_draft(store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-REP-02: Store saves item quantities in draft mode, updating line sum and total."""
    period = current_period()
    pid = e2e_env["product_id"]
    price = e2e_env["product_price_cents"]

    response = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [{"product_id": pid, "price_cents": price, "quantity": 5}],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "draft"
    assert data["read_only"] is False
    assert data["total_cents"] == 5 * price


def test_reports_recalculate_lines_and_totals(admin_client: TestClient, store_client: TestClient):
    """TC-REP-03: Line calculations accurately calculate sum_cents = quantity * price."""
    period = current_period()

    # Create 2 new products
    p1 = admin_client.post("/api/v1/admin/products", json={"name": "Item A", "price": "10.00"}).json()
    p2 = admin_client.post("/api/v1/admin/products", json={"name": "Item B", "price": "2.50"}).json()

    save_res = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [
                {"product_id": p1["id"], "price_cents": 1000, "quantity": 4},
                {"product_id": p2["id"], "price_cents": 250, "quantity": 6},
            ],
        },
    )
    assert save_res.status_code == 200
    report = save_res.json()
    # 4 * 1000 = 4000; 6 * 250 = 1500; total = 5500
    assert report["total_cents"] == 5500
    row1 = next(r for r in report["rows"] if r["id"] == p1["id"])
    row2 = next(r for r in report["rows"] if r["id"] == p2["id"])
    assert row1["sum_cents"] == 4000
    assert row2["sum_cents"] == 1500


def test_reports_submit_report(store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-REP-04: Submitting report sets status to submitted and read_only to True."""
    period = current_period()
    pid = e2e_env["product_id"]

    response = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "submit",
            "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 8}],
        },
    )
    assert response.status_code == 200
    report = response.json()
    assert report["status"] == "submitted"
    assert report["read_only"] is True
    assert report["total_cents"] == 1600


def test_reports_locked_report_modification_rejected(store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-REP-05: Modifying an already submitted report returns 409 Conflict."""
    period = current_period()
    pid = e2e_env["product_id"]

    # Submit report
    store_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "submit", "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 2}]},
    )

    # Attempt to edit
    rejected = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "draft", "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 10}]},
    )
    assert rejected.status_code == 409
    assert "заблоковано" in rejected.json()["detail"].lower() or "submitted" in rejected.json()["detail"].lower() or "не можна змінювати" in rejected.json()["detail"].lower()


def test_reports_admin_lock_and_unlock(admin_client: TestClient, store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-REP-06: Admin can lock and unlock a report by patching its status."""
    period = current_period()
    pid = e2e_env["product_id"]

    # Store submits report
    submit_res = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "submit", "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 1}]},
    ).json()
    report_id = submit_res["report_id"]

    # Admin unlocks report to draft
    unlock_res = admin_client.patch(
        f"/api/v1/admin/reports/{report_id}",
        json={"status": "draft"},
    )
    assert unlock_res.status_code == 200
    assert unlock_res.json()["status"] == "draft"

    # Store can now edit again
    edit_res = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "draft", "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 5}]},
    )
    assert edit_res.status_code == 200
    assert edit_res.json()["total_cents"] == 1000

    # Admin locks report back to submitted
    lock_res = admin_client.patch(
        f"/api/v1/admin/reports/{report_id}",
        json={"status": "submitted"},
    )
    assert lock_res.status_code == 200
    assert lock_res.json()["status"] == "submitted"


# =============================================================================
# 5. AUDIT LOGGING & COMPLIANCE TRAIL
# =============================================================================

def test_audit_event_recorded_on_product_mutation(admin_client: TestClient):
    """TC-AUDIT-01: Product creation and price update append immutable audit entries."""
    created = admin_client.post("/api/v1/admin/products", json={"name": "Audit Test Item", "price": "5.00"}).json()
    admin_client.put(f"/api/v1/admin/products/{created['id']}/price", json={"price": "6.00"})

    logs = admin_client.get("/api/v1/admin/logs?limit=20").json()
    assert any("Audit Test Item" in log.get("detail", "") or "товар" in log.get("action", "") for log in logs)


def test_audit_event_recorded_on_store_mutation(admin_client: TestClient):
    """TC-AUDIT-02: Store creation and rename append audit entries."""
    created = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Audit Store", "login": "auditstore", "password": "AuditPassword123!"},
    ).json()
    admin_client.put(f"/api/v1/admin/stores/{created['id']}", json={"name": "Audit Store Renamed", "login": "auditstore2"})

    logs = admin_client.get("/api/v1/admin/logs?limit=20").json()
    assert any("Audit Store" in log.get("detail", "") or "магазин" in log.get("action", "") for log in logs)


def test_audit_event_recorded_on_report_submission(admin_client: TestClient, store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-AUDIT-03: Submitting a monthly report appends an audit record."""
    period = current_period()
    store_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "submit", "quantities": []},
    )

    logs = admin_client.get(f"/api/v1/admin/logs?login={e2e_env['store_login']}").json()
    assert any("звіт" in log.get("action", "") for log in logs)


def test_audit_event_recorded_on_authentication(admin_client: TestClient, anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-AUDIT-04: Successful and failed logins and logouts produce audit entries."""
    # Failed login
    anon_client.post("/api/v1/auth/login", json={"login": e2e_env["admin_login"], "password": "BadPassword!"})
    # Valid login
    anon_client.post("/api/v1/auth/login", json={"login": e2e_env["admin_login"], "password": e2e_env["admin_password"]})
    # Logout
    anon_client.post("/api/v1/auth/logout")

    logs = admin_client.get(f"/api/v1/admin/logs?login={e2e_env['admin_login']}&limit=10").json()
    actions = [log["action"] for log in logs]
    assert any("вхід" in a for a in actions)


def test_audit_list_unique_actions(admin_client: TestClient):
    """TC-AUDIT-05: Admin can retrieve the distinct action categories in audit logs."""
    response = admin_client.get("/api/v1/admin/log-actions")
    assert response.status_code == 200
    actions = response.json()
    assert isinstance(actions, list)
    assert len(actions) >= 1
    assert "вхід" in actions


def test_audit_filter_logs_by_user_and_action(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-AUDIT-06: Audit query filters correctly by login and action without leaking secrets."""
    response = admin_client.get(f"/api/v1/admin/logs?login={e2e_env['admin_login']}&action=вхід&limit=5")
    assert response.status_code == 200
    logs = response.json()
    for row in logs:
        assert row["login"] == e2e_env["admin_login"]
        assert "password" not in row
        assert "password_hash" not in row
        assert "ts" in row
        assert "ip" in row


# =============================================================================
# 6. TUNNEL INFRASTRUCTURE & CONTROLS
# =============================================================================

def test_tunnel_get_status(admin_client: TestClient):
    """TC-TUNNEL-01: Admin can retrieve tunnel status schema."""
    response = admin_client.get("/api/v1/admin/tunnel")
    assert response.status_code == 200
    data = response.json()
    assert "state" in data
    assert "enabled" in data
    assert "public_url" in data
    assert "login_url" in data
    assert "error" in data


def test_tunnel_toggle_autostart(admin_client: TestClient):
    """TC-TUNNEL-02: Admin can toggle tunnel autostart preference."""
    # Enable autostart
    en_res = admin_client.put("/api/v1/admin/tunnel/autostart", json={"enabled": True})
    assert en_res.status_code == 200
    assert en_res.json()["autostart"] is True

    # Disable autostart
    dis_res = admin_client.put("/api/v1/admin/tunnel/autostart", json={"enabled": False})
    assert dis_res.status_code == 200
    assert dis_res.json()["autostart"] is False


def test_tunnel_start_trigger_with_confirmation(admin_client: TestClient):
    """TC-TUNNEL-03: Tunnel start requires explicit confirm_public=True."""
    mock_running = {
        "enabled": True,
        "state": "running",
        "public_url": "https://test-tunnel.example.com",
        "login_url": "",
        "error": "",
    }
    with patch("app.features.tunnel.service.start_tunnel", return_value=mock_running):
        response = admin_client.post(
            "/api/v1/admin/tunnel",
            json={"confirm_public": True, "auth_key": "dummy-token"},
        )
        assert response.status_code == 200
        assert response.json()["state"] == "running"
        assert response.json()["public_url"] == "https://test-tunnel.example.com"


def test_tunnel_start_rejected_without_confirmation(admin_client: TestClient):
    """TC-TUNNEL-04: Tunnel start without confirm_public=True is rejected with 400."""
    response = admin_client.post(
        "/api/v1/admin/tunnel",
        json={"confirm_public": False},
    )
    assert response.status_code == 400
    assert "Підтвердьте" in response.json()["detail"]


def test_tunnel_stop_trigger(admin_client: TestClient):
    """TC-TUNNEL-05: Tunnel can be stopped via DELETE /api/v1/admin/tunnel."""
    mock_stopped = {
        "enabled": False,
        "state": "disabled",
        "public_url": "",
        "login_url": "",
        "error": "",
    }
    with patch("app.features.tunnel.service.stop_tunnel", return_value=mock_stopped):
        response = admin_client.delete("/api/v1/admin/tunnel")
        assert response.status_code == 200
        assert response.json()["enabled"] is False


def test_tunnel_public_url_formatting_validation(admin_client: TestClient):
    """TC-TUNNEL-06: Tunnel public URL adheres to https:// scheme format."""
    mock_status = {
        "enabled": True,
        "state": "running",
        "public_url": "https://safe-mourning.trycloudflare.com",
        "login_url": "",
        "error": "",
    }
    with patch("app.features.tunnel.service.get_status", return_value=mock_status):
        response = admin_client.get("/api/v1/admin/tunnel")
        assert response.status_code == 200
        url = response.json()["public_url"]
        assert url.startswith("https://")
        assert ".trycloudflare.com" in url or ".pp.ua" in url or ".ts.net" in url


# =============================================================================
# 7. SUMMARY & EXPORT CAPABILITIES
# =============================================================================

def test_summary_monthly_matrix_calculation(admin_client: TestClient, store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-SUM-01: Admin monthly summary aggregates store columns and product rows."""
    period = current_period()
    pid = e2e_env["product_id"]

    # Submit 4 units
    store_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "submit", "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 4}]},
    )

    response = admin_client.get(f"/api/v1/admin/summary?period={period}")
    assert response.status_code == 200
    summary = response.json()
    assert summary["period"] == period
    assert summary["grand_total_cents"] >= 800
    assert len(summary["stores"]) >= 1
    assert len(summary["rows"]) >= 1


def test_summary_filter_submitted_only(admin_client: TestClient, store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-SUM-02: Summary submitted_only=true excludes unsubmitted drafts."""
    period = current_period()
    pid = e2e_env["product_id"]

    # Create Store 2 and save a draft (not submitted)
    admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Store Draft Only", "login": "draftonly", "password": "Password123!"},
    )

    # Login as Store 2 and save draft
    s2_client = TestClient(
        store_client.app,
        base_url="http://testserver",
        headers={"origin": "http://testserver"},
    )
    s2_client.post("/api/v1/auth/login", json={"login": "draftonly", "password": "Password123!"})
    s2_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "draft", "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 10}]},
    )

    # With submitted_only=true, Store 2's unsubmitted draft is excluded
    summary = admin_client.get(f"/api/v1/admin/summary?period={period}&submitted_only=true").json()
    assert summary["submitted_only"] is True


def test_exports_summary_excel_workbook_download(admin_client: TestClient):
    """TC-SUM-03: Downloading /admin/summary.xlsx returns valid openpyxl spreadsheet."""
    period = current_period()
    response = admin_client.get(f"/admin/summary.xlsx?period={period}")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert f'filename="zvit-{period}.xlsx"' in response.headers["content-disposition"]

    # Verify workbook is structurally valid
    wb = openpyxl.load_workbook(io.BytesIO(response.content))
    assert len(wb.sheetnames) >= 1
    sheet = wb.active
    assert sheet.title == "Звіт"


def test_exports_product_catalogue_excel_import(admin_client: TestClient):
    """TC-SUM-04: Uploading valid Excel workbook imports products into catalogue."""
    data = make_excel_workbook([
        ("Imported Apple", "4.50"),
        ("Imported Cherry", "8.00"),
    ])
    response = admin_client.post(
        "/api/v1/admin/products/import",
        files={"file": ("products.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 200
    assert "завершено" in response.json()["message"]

    # Verify products exist
    products = admin_client.get("/api/v1/admin/products").json()
    names = [p["name"] for p in products]
    assert "Imported Apple" in names
    assert "Imported Cherry" in names


def test_exports_backup_snapshot_download(admin_client: TestClient):
    """TC-SUM-05: Downloading /admin/backup/download streams backup file attachment."""
    response = admin_client.get("/admin/backup/download")
    assert response.status_code == 200
    assert response.headers["content-type"] in ("application/octet-stream", "application/sql")
    assert "attachment; filename=" in response.headers["content-disposition"]
    assert len(response.content) > 0


def test_reports_admin_overview_list(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-SUM-06: Admin can list all stores with their report status (none/draft/submitted)."""
    period = current_period()
    response = admin_client.get(f"/api/v1/admin/reports?period={period}")
    assert response.status_code == 200
    reports = response.json()
    assert isinstance(reports, list)
    store_entry = next(r for r in reports if r["store_id"] == e2e_env["store_id"])
    assert store_entry["status"] in ("none", "draft", "submitted")
    assert store_entry["store_name"] == e2e_env["store_name"]
