"""Tier 2 - Boundary & Corner Cases E2E Tests (>=5 test cases per feature).

Coverage Areas:
1. Empty / whitespace logins and passwords (6 test cases)
2. Zero, negative, and extreme product prices / quantities (7 test cases)
3. Duplicate store logins and duplicate store names (6 test cases)
4. Cross-period report editing and invalid period formats (7 test cases)
5. Rate limit boundaries on rapid repeated login attempts (5 test cases)
Total: 31 test cases
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from app.core.ratelimit import _fails
from app.core.periods import current_period

# =============================================================================
# 1. EMPTY / WHITESPACE LOGINS AND PASSWORDS
# =============================================================================

def test_login_empty_username_rejected(anon_client: TestClient):
    """TC-BND-AUTH-01: Empty login string is rejected with 422 validation error."""
    response = anon_client.post(
        "/api/v1/auth/login",
        json={"login": "", "password": "AnyValidPassword123!"},
    )
    assert response.status_code == 422


def test_login_whitespace_only_username_rejected(anon_client: TestClient):
    """TC-BND-AUTH-02: Whitespace-only login string is stripped and rejected with 401."""
    response = anon_client.post(
        "/api/v1/auth/login",
        json={"login": "   ", "password": "AnyValidPassword123!"},
    )
    assert response.status_code == 401


def test_login_empty_password_rejected(anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-AUTH-03: Empty password string is rejected with 422 validation error."""
    response = anon_client.post(
        "/api/v1/auth/login",
        json={"login": e2e_env["admin_login"], "password": ""},
    )
    assert response.status_code == 422


def test_login_whitespace_only_password_rejected(anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-AUTH-04: Whitespace-only password fails credential check with 401."""
    response = anon_client.post(
        "/api/v1/auth/login",
        json={"login": e2e_env["admin_login"], "password": "   "},
    )
    assert response.status_code == 401


def test_store_create_short_password_rejected(admin_client: TestClient):
    """TC-BND-AUTH-05: Store creation with password < 6 characters is rejected with 422."""
    response = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Short Pass Store", "login": "shortpass", "password": "123"},
    )
    assert response.status_code == 422


def test_admin_change_password_short_password_rejected(admin_client: TestClient):
    """TC-BND-AUTH-06: Changing password to < 6 characters is rejected with 422."""
    response = admin_client.put(
        "/api/v1/admin/password",
        json={"password": "12345"},
    )
    assert response.status_code == 422


# =============================================================================
# 2. ZERO, NEGATIVE, AND EXTREME PRODUCT PRICES / QUANTITIES
# =============================================================================

def test_product_create_zero_price_accepted(admin_client: TestClient):
    """TC-BND-PRC-01: Zero price string ('0.00') is accepted with price_cents=0."""
    response = admin_client.post(
        "/api/v1/admin/products",
        json={"name": "Free Promo Sample", "price": "0.00"},
    )
    assert response.status_code == 201
    assert response.json()["price_cents"] == 0


def test_product_create_negative_price_rejected(admin_client: TestClient):
    """TC-BND-PRC-02: Negative price is rejected with 422 validation error."""
    response = admin_client.post(
        "/api/v1/admin/products",
        json={"name": "Negative Price Item", "price": "-10.00"},
    )
    assert response.status_code == 422


def test_product_create_malformed_price_rejected(admin_client: TestClient):
    """TC-BND-PRC-03: Malformed alphanumeric price string is rejected with 422."""
    response = admin_client.post(
        "/api/v1/admin/products",
        json={"name": "Bad Price Item", "price": "ten-dollars"},
    )
    assert response.status_code == 422


def test_product_create_extreme_price_rejected(admin_client: TestClient):
    """TC-BND-PRC-04: Exorbitant price exceeding 1,000,000,000 cents is rejected with 422."""
    response = admin_client.post(
        "/api/v1/admin/products",
        json={"name": "Billionaire Item", "price": "99999999999.00"},
    )
    assert response.status_code == 422


def test_report_item_zero_quantity_accepted(store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-PRC-05: Saving item with quantity=0 succeeds and yields sum_cents=0."""
    period = current_period()
    pid = e2e_env["product_id"]
    price = e2e_env["product_price_cents"]

    response = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [{"product_id": pid, "price_cents": price, "quantity": 0}],
        },
    )
    assert response.status_code == 200
    assert response.json()["total_cents"] == 0


def test_report_item_negative_quantity_rejected(store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-PRC-06: Negative quantity in report is rejected with 422 validation error."""
    period = current_period()
    pid = e2e_env["product_id"]
    price = e2e_env["product_price_cents"]

    response = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [{"product_id": pid, "price_cents": price, "quantity": -5}],
        },
    )
    assert response.status_code == 422


def test_report_item_extreme_quantity_calculated(store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-PRC-07: Large quantity (100,000 units) calculates without overflow."""
    period = current_period()
    pid = e2e_env["product_id"]
    price = e2e_env["product_price_cents"]  # 200 cents

    response = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [{"product_id": pid, "price_cents": price, "quantity": 100_000}],
        },
    )
    assert response.status_code == 200
    # 100,000 * 200 = 20,000,000 cents
    assert response.json()["total_cents"] == 20_000_000


# =============================================================================
# 3. DUPLICATE STORE LOGINS AND DUPLICATE STORE NAMES
# =============================================================================

def test_store_create_duplicate_name_rejected(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-DUP-01: Creating store with existing store name returns 409 or 422."""
    response = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": e2e_env["store_name"], "login": "distinct_login_1", "password": "Password123!"},
    )
    assert response.status_code in (409, 422)
    assert "існує" in response.json()["detail"].lower()


def test_store_create_duplicate_login_rejected(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-DUP-02: Creating store with existing store login returns 409 or 422."""
    response = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Distinct Store Name", "login": e2e_env["store_login"], "password": "Password123!"},
    )
    assert response.status_code in (409, 422)
    assert "існує" in response.json()["detail"].lower() or "зайнятий" in response.json()["detail"].lower()


def test_store_create_case_insensitive_duplicate_login_rejected(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-DUP-03: Logins are case-insensitive; uppercase duplicate returns 409 or 422."""
    upper_login = e2e_env["store_login"].upper()
    response = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Case Test Store", "login": upper_login, "password": "Password123!"},
    )
    assert response.status_code in (409, 422)
    assert "існує" in response.json()["detail"].lower() or "зайнятий" in response.json()["detail"].lower()


def test_store_rename_duplicate_name_rejected(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-DUP-04: Renaming Store B to Store A's name returns 409 or 422."""
    store2 = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Store Two", "login": "storetwo", "password": "Password123!"},
    ).json()

    response = admin_client.put(
        f"/api/v1/admin/stores/{store2['id']}",
        json={"name": e2e_env["store_name"], "login": "storetwo"},
    )
    assert response.status_code in (409, 422)
    assert "існує" in response.json()["detail"].lower()


def test_store_rename_duplicate_login_rejected(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-DUP-05: Renaming Store B's login to Store A's login returns 409 or 422."""
    store2 = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Store Three", "login": "storethree", "password": "Password123!"},
    ).json()

    response = admin_client.put(
        f"/api/v1/admin/stores/{store2['id']}",
        json={"name": "Store Three", "login": e2e_env["store_login"]},
    )
    assert response.status_code in (409, 422)
    assert "існує" in response.json()["detail"].lower() or "зайнятий" in response.json()["detail"].lower()


def test_store_rename_self_no_false_conflict(admin_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-DUP-06: Renaming store to its own existing name and login succeeds (no self-conflict)."""
    sid = e2e_env["store_id"]
    response = admin_client.put(
        f"/api/v1/admin/stores/{sid}",
        json={"name": e2e_env["store_name"], "login": e2e_env["store_login"]},
    )
    assert response.status_code == 200
    assert response.json()["name"] == e2e_env["store_name"]
    assert response.json()["login"] == e2e_env["store_login"]


# =============================================================================
# 4. CROSS-PERIOD REPORT EDITING AND INVALID PERIOD FORMATS
# =============================================================================

def test_report_invalid_period_format_non_numeric(store_client: TestClient):
    """TC-BND-PER-01: Non-numeric period string returns 400 Bad Request."""
    response = store_client.get("/api/v1/store/reports/october-2026")
    assert response.status_code == 400
    assert "Період має мати вигляд" in response.json()["detail"]


def test_report_invalid_period_format_wrong_separator(store_client: TestClient):
    """TC-BND-PER-02: Period with slash separator ('2026/10') returns 400 or 404."""
    response = store_client.get("/api/v1/store/reports/2026/10")
    assert response.status_code in (400, 404)


def test_report_invalid_period_month_out_of_range(store_client: TestClient):
    """TC-BND-PER-03: Period with month 13 or 00 returns 400 Bad Request."""
    assert store_client.get("/api/v1/store/reports/2026-13").status_code == 400
    assert store_client.get("/api/v1/store/reports/2026-00").status_code == 400


def test_report_period_with_trailing_characters(store_client: TestClient):
    """TC-BND-PER-04: Period with day or trailing garbage ('2026-10-01') returns 400 Bad Request."""
    response = store_client.get("/api/v1/store/reports/2026-10-01")
    assert response.status_code == 400
    assert "Період має мати вигляд" in response.json()["detail"]


def test_report_edit_closed_historical_period_forbidden(store_client: TestClient):
    """TC-BND-PER-05: Modifying a non-existent past historical period returns 403 or 404."""
    response = store_client.put(
        "/api/v1/store/reports/2020-01",
        json={"action": "draft", "quantities": []},
    )
    assert response.status_code in (403, 404)


def test_report_duplicate_product_price_inputs_rejected(store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-PER-06: Duplicate (product_id, price_cents) rows in report payload return 422."""
    period = current_period()
    pid = e2e_env["product_id"]
    price = e2e_env["product_price_cents"]

    response = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [
                {"product_id": pid, "price_cents": price, "quantity": 1},
                {"product_id": pid, "price_cents": price, "quantity": 2},
            ],
        },
    )
    assert response.status_code == 422
    assert "повторюється" in response.json()["detail"].lower() or "дублюються" in response.json()["detail"].lower()


def test_report_stale_or_unknown_price_cents_rejected(store_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-PER-07: Submitting an unregistered price_cents for a product returns 409 Conflict."""
    period = current_period()
    pid = e2e_env["product_id"]

    response = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [{"product_id": pid, "price_cents": 99999, "quantity": 1}],
        },
    )
    assert response.status_code == 409
    assert "змінилися" in response.json()["detail"].lower() or "ціна" in response.json()["detail"].lower()


# =============================================================================
# 5. RATE LIMIT BOUNDARIES ON RAPID REPEATED LOGIN ATTEMPTS
# =============================================================================

def test_rate_limit_failures_1_through_4_return_401(anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-RATE-01: First 4 failed password attempts are rejected with 401 (not throttled)."""
    _fails.clear()
    for _ in range(4):
        response = anon_client.post(
            "/api/v1/auth/login",
            json={"login": e2e_env["admin_login"], "password": "WrongPassword!"},
        )
        assert response.status_code == 401
        assert "Retry-After" not in response.headers


def test_rate_limit_5th_failure_triggers_429(anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-RATE-02: Exceeding 5 consecutive failed attempts triggers 429 Too Many Requests."""
    _fails.clear()
    for _ in range(5):
        anon_client.post(
            "/api/v1/auth/login",
            json={"login": e2e_env["admin_login"], "password": "WrongPassword!"},
        )

    throttled = anon_client.post(
        "/api/v1/auth/login",
        json={"login": e2e_env["admin_login"], "password": "WrongPassword!"},
    )
    assert throttled.status_code == 429
    assert "Retry-After" in throttled.headers
    assert int(throttled.headers["Retry-After"]) > 0


def test_rate_limit_blocks_subsequent_attempts_immediately(anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-RATE-03: While throttled, subsequent attempts (even with correct pw) return 429."""
    _fails.clear()
    for _ in range(5):
        anon_client.post(
            "/api/v1/auth/login",
            json={"login": e2e_env["admin_login"], "password": "WrongPassword!"},
        )

    # 6th attempt with valid credentials is also blocked by throttle
    blocked = anon_client.post(
        "/api/v1/auth/login",
        json={"login": e2e_env["admin_login"], "password": e2e_env["admin_password"]},
    )
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


def test_rate_limit_isolation_across_different_logins(anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-RATE-04: Throttling one account login does not block another distinct account."""
    _fails.clear()
    # Trigger throttle on admin login
    for _ in range(5):
        anon_client.post(
            "/api/v1/auth/login",
            json={"login": e2e_env["admin_login"], "password": "WrongPassword!"},
        )

    # Store account login from same client is not blocked by pair throttle
    store_login = anon_client.post(
        "/api/v1/auth/login",
        json={"login": e2e_env["store_login"], "password": e2e_env["store_password"]},
    )
    assert store_login.status_code == 200


def test_rate_limit_reset_after_successful_auth(anon_client: TestClient, e2e_env: dict[str, Any]):
    """TC-BND-RATE-05: Successful authentication clears failure counters for the pair."""
    _fails.clear()
    # 3 failures (under limit)
    for _ in range(3):
        anon_client.post(
            "/api/v1/auth/login",
            json={"login": e2e_env["store_login"], "password": "WrongPassword!"},
        )

    # Successful login clears pair failure counter
    success = anon_client.post(
        "/api/v1/auth/login",
        json={"login": e2e_env["store_login"], "password": e2e_env["store_password"]},
    )
    assert success.status_code == 200

    # Next 4 failures still return 401 rather than 429
    for _ in range(4):
        res = anon_client.post(
            "/api/v1/auth/login",
            json={"login": e2e_env["store_login"], "password": "WrongPassword!"},
        )
        assert res.status_code == 401
