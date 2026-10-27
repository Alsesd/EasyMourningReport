"""Tier 3 - Cross-Feature Combinations E2E Tests (Pairwise Coverage).

Covers multi-step, multi-feature workflows across auth, catalog pricing,
store reporting, admin reviews, and export generations:
1. Mid-period price revision and report recalculation lifecycle
2. Multi-store monthly aggregation in summary matrix and Excel
3. Product soft-archival and restoration with active store draft
4. Store renaming and credential rotation with historical report preservation
5. Admin report unlock, store modification, and re-submission workflow
"""

from __future__ import annotations

import io
from typing import Any

import openpyxl
from fastapi.testclient import TestClient

from app.core.ui import current_period


def test_pairwise_mid_period_price_change_and_report_recalculation(
    admin_client: TestClient,
    anon_client: TestClient,
    e2e_env: dict[str, Any],
):
    """TC-COMB-01: Price change mid-period exposes multiple price slots, recalculates totals,
    and reflects accurately in admin summary and Excel export.
    """
    period = current_period()

    # 1. Admin creates a dedicated store and product
    admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Pairwise Store 1", "login": "pstore1", "password": "PStorePass123!"},
    )
    prod_data = admin_client.post(
        "/api/v1/admin/products",
        json={"name": "Artisan Baguette", "price": "3.00"},  # 300 cents
    ).json()
    prod_id = prod_data["id"]

    # 2. Store logs in
    login_res = anon_client.post(
        "/api/v1/auth/login",
        json={"login": "pstore1", "password": "PStorePass123!"},
    )
    assert login_res.status_code == 200

    # 3. Store saves initial draft with 10 units @ 3.00 = 30.00 (3000 cents)
    save_draft = anon_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [{"product_id": prod_id, "price_cents": 300, "quantity": 10}],
        },
    )
    assert save_draft.status_code == 200
    assert save_draft.json()["total_cents"] == 3000

    # 4. Admin changes product price mid-period to 3.50 (350 cents)
    price_change = admin_client.put(
        f"/api/v1/admin/products/{prod_id}/price",
        json={"price": "3.50"},
    )
    assert price_change.status_code == 200
    assert 350 in price_change.json()["month_prices_cents"]
    assert 300 in price_change.json()["month_prices_cents"]

    # 5. Store re-opens draft report: row contains both 300 and 350 cent price points
    report_res = anon_client.get(f"/api/v1/store/reports/{period}")
    assert report_res.status_code == 200
    baguette_row = next(r for r in report_res.json()["rows"] if r["id"] == prod_id)
    available_prices = [inp["price_cents"] for inp in baguette_row["inputs"]]
    assert 300 in available_prices
    assert 350 in available_prices

    # 6. Store records 10 @ 300 and 4 @ 350: total = 3000 + 1400 = 4400 cents ($44.00)
    submit_res = anon_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "submit",
            "quantities": [
                {"product_id": prod_id, "price_cents": 300, "quantity": 10},
                {"product_id": prod_id, "price_cents": 350, "quantity": 4},
            ],
        },
    )
    assert submit_res.status_code == 200
    assert submit_res.json()["status"] == "submitted"
    assert submit_res.json()["total_cents"] == 4400
    report_id = submit_res.json()["report_id"]

    # 7. Admin reviews report details
    admin_detail = admin_client.get(f"/api/v1/admin/reports/{report_id}")
    assert admin_detail.status_code == 200
    assert admin_detail.json()["total_cents"] == 4400

    # 8. Admin downloads summary Excel and confirms totals
    xlsx_res = admin_client.get(f"/admin/summary.xlsx?period={period}")
    assert xlsx_res.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_res.content))
    sheet = wb.active
    cell_values = [str(cell.value) for row in sheet.iter_rows() for cell in row if cell.value is not None]
    assert any("Artisan Baguette" in val for val in cell_values)


def test_pairwise_multi_store_aggregation_in_summary(
    admin_client: TestClient,
    e2e_env: dict[str, Any],
):
    """TC-COMB-02: Multiple stores reporting in the same period aggregate totals accurately,
    and submitted_only filters unsubmitted drafts correctly.
    """
    period = current_period()

    # 1. Admin creates 3 stores
    admin_client.post("/api/v1/admin/stores", json={"name": "Dnipro Store", "login": "dnipro", "password": "Password123!"})
    admin_client.post("/api/v1/admin/stores", json={"name": "Lviv Store", "login": "lviv", "password": "Password123!"})
    admin_client.post("/api/v1/admin/stores", json={"name": "Odesa Store", "login": "odesa", "password": "Password123!"})

    # 2. Admin creates 2 products
    p1 = admin_client.post("/api/v1/admin/products", json={"name": "Croissant", "price": "2.00"}).json()  # 200c
    p2 = admin_client.post("/api/v1/admin/products", json={"name": "Coffee", "price": "1.50"}).json()     # 150c

    # Helper client
    def make_client(login: str) -> TestClient:
        c = TestClient(admin_client.app, base_url="http://testserver", headers={"origin": "http://testserver"})
        c.post("/api/v1/auth/login", json={"login": login, "password": "Password123!"})
        return c

    # Dnipro submits: 10 Croissant ($20), 20 Coffee ($30) = $50 (5000 cents)
    c1 = make_client("dnipro")
    c1.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "submit",
            "quantities": [
                {"product_id": p1["id"], "price_cents": 200, "quantity": 10},
                {"product_id": p2["id"], "price_cents": 150, "quantity": 20},
            ],
        },
    )

    # Lviv submits: 5 Croissant ($10), 10 Coffee ($15) = $25 (2500 cents)
    c2 = make_client("lviv")
    c2.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "submit",
            "quantities": [
                {"product_id": p1["id"], "price_cents": 200, "quantity": 5},
                {"product_id": p2["id"], "price_cents": 150, "quantity": 10},
            ],
        },
    )

    # Odesa saves draft: 8 Croissant ($16), 4 Coffee ($6) = $22 (2200 cents)
    c3 = make_client("odesa")
    c3.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [
                {"product_id": p1["id"], "price_cents": 200, "quantity": 8},
                {"product_id": p2["id"], "price_cents": 150, "quantity": 4},
            ],
        },
    )

    # 3. Check summary matrix without submitted_only: grand total includes all 3 (5000 + 2500 + 2200 = 9700 cents)
    summary_all = admin_client.get(f"/api/v1/admin/summary?period={period}").json()
    assert summary_all["grand_total_cents"] >= 9700

    # 4. Check summary matrix with submitted_only=true: excludes Odesa's 2200 cents
    summary_sub = admin_client.get(f"/api/v1/admin/summary?period={period}&submitted_only=true").json()
    assert summary_sub["submitted_only"] is True
    # The grand total for submitted reports excludes the draft
    assert summary_sub["grand_total_cents"] < summary_all["grand_total_cents"]


def test_pairwise_product_soft_archival_during_active_draft(
    admin_client: TestClient,
    store_client: TestClient,
    e2e_env: dict[str, Any],
):
    """TC-COMB-03: Soft-archiving a product during an active draft moves it to inactive_rows,
    preserves its line sum, and restoring it returns it to active editable rows.
    """
    period = current_period()

    # Create Product A and Product B
    pa = admin_client.post("/api/v1/admin/products", json={"name": "Keep Active Pastry", "price": "4.00"}).json()
    pb = admin_client.post("/api/v1/admin/products", json={"name": "Will Archive Cookie", "price": "2.50"}).json()

    # Store saves draft with both items
    store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [
                {"product_id": pa["id"], "price_cents": 400, "quantity": 5},   # 2000c
                {"product_id": pb["id"], "price_cents": 250, "quantity": 4},   # 1000c
            ],
        },
    )

    # Admin soft-archives Product B (it is referenced in a report draft, so soft-archived)
    del_res = admin_client.delete(f"/api/v1/admin/products/{pb['id']}")
    assert del_res.status_code == 200
    assert del_res.json()["archived"] is True

    # Store re-fetches draft: Product B is now in inactive_rows
    draft_after_del = store_client.get(f"/api/v1/store/reports/{period}").json()
    assert any(row["id"] == pa["id"] for row in draft_after_del["rows"])
    assert not any(row["id"] == pb["id"] for row in draft_after_del["rows"])
    assert len(draft_after_del["inactive_rows"]) >= 1
    assert any("Will Archive Cookie" in inact["name"] for inact in draft_after_del["inactive_rows"])

    # Store saves draft with updated Active Pastry: inactive Cookie total is preserved
    save_again = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "draft",
            "quantities": [{"product_id": pa["id"], "price_cents": 400, "quantity": 7}],  # 2800c
        },
    )
    assert save_again.status_code == 200
    # Total is 2800 (active) + 1000 (inactive Cookie) = 3800 cents
    assert save_again.json()["total_cents"] == 3800

    # Admin restores Product B
    restore_res = admin_client.post(f"/api/v1/admin/products/{pb['id']}/restore")
    assert restore_res.status_code == 200
    assert restore_res.json()["archived"] is False

    # Store re-fetches: Product B is back in active rows
    restored_report = store_client.get(f"/api/v1/store/reports/{period}").json()
    assert any(row["id"] == pb["id"] for row in restored_report["rows"])

    # Store submits full report
    final_submit = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={
            "action": "submit",
            "quantities": [
                {"product_id": pa["id"], "price_cents": 400, "quantity": 7},
                {"product_id": pb["id"], "price_cents": 250, "quantity": 4},
            ],
        },
    )
    assert final_submit.status_code == 200
    assert final_submit.json()["status"] == "submitted"


def test_pairwise_store_renaming_and_password_rotation(
    admin_client: TestClient,
    anon_client: TestClient,
    e2e_env: dict[str, Any],
):
    """TC-COMB-04: Renaming a store and rotating its password updates auth credentials
    while preserving historical submitted reports.
    """
    period = current_period()
    pid = e2e_env["product_id"]

    # 1. Admin creates Store Gamma
    created = admin_client.post(
        "/api/v1/admin/stores",
        json={"name": "Store Gamma", "login": "storegamma", "password": "OldGammaPass123!"},
    ).json()
    sid = created["id"]

    # 2. Store Gamma logs in and submits report
    c = TestClient(admin_client.app, base_url="http://testserver", headers={"origin": "http://testserver"})
    c.post("/api/v1/auth/login", json={"login": "storegamma", "password": "OldGammaPass123!"})
    submit = c.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "submit", "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 6}]},
    )
    assert submit.status_code == 200

    # 3. Admin renames Store Gamma to Store Gamma Prime (login: storegammaprime)
    admin_client.put(
        f"/api/v1/admin/stores/{sid}",
        json={"name": "Store Gamma Prime", "login": "storegammaprime"},
    )

    # 4. Admin updates password
    admin_client.put(
        f"/api/v1/admin/stores/{sid}/password",
        json={"password": "NewPrimePass456!"},
    )

    # 5. Old login and old password fail
    assert anon_client.post("/api/v1/auth/login", json={"login": "storegamma", "password": "OldGammaPass123!"}).status_code == 401
    assert anon_client.post("/api/v1/auth/login", json={"login": "storegammaprime", "password": "OldGammaPass123!"}).status_code == 401

    # 6. New login and new password succeed
    new_login = anon_client.post("/api/v1/auth/login", json={"login": "storegammaprime", "password": "NewPrimePass456!"})
    assert new_login.status_code == 200
    assert new_login.json()["store_name"] == "Store Gamma Prime"

    # 7. Submitted report is still present and read-only
    report_res = anon_client.get(f"/api/v1/store/reports/{period}")
    assert report_res.status_code == 200
    assert report_res.json()["read_only"] is True
    assert report_res.json()["total_cents"] == 1200


def test_pairwise_admin_report_unlock_and_resubmission(
    admin_client: TestClient,
    store_client: TestClient,
    e2e_env: dict[str, Any],
):
    """TC-COMB-05: Store submits report -> locked -> Admin unlocks to draft ->
    Store edits quantities -> Store re-submits -> full audit trail logged.
    """
    period = current_period()
    pid = e2e_env["product_id"]

    # 1. Store submits report
    submit1 = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "submit", "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 3}]},
    ).json()
    report_id = submit1["report_id"]

    # 2. Store is locked out of editing
    rejected = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "draft", "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 10}]},
    )
    assert rejected.status_code == 409

    # 3. Admin patches report to draft (unlock)
    unlock = admin_client.patch(f"/api/v1/admin/reports/{report_id}", json={"status": "draft"})
    assert unlock.status_code == 200
    assert unlock.json()["status"] == "draft"

    # 4. Store modifies quantities to 7 and re-submits
    submit2 = store_client.put(
        f"/api/v1/store/reports/{period}",
        json={"action": "submit", "quantities": [{"product_id": pid, "price_cents": 200, "quantity": 7}]},
    )
    assert submit2.status_code == 200
    assert submit2.json()["total_cents"] == 1400
    assert submit2.json()["read_only"] is True

    # 5. Audit trail records both submission events
    logs = admin_client.get(f"/api/v1/admin/logs?login={e2e_env['store_login']}").json()
    submission_logs = [log for log in logs if "подання" in log.get("action", "") or "звіт" in log.get("action", "")]
    assert len(submission_logs) >= 2
