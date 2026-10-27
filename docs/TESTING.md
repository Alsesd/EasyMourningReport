# Testing Infrastructure: EasyMourningReport (Tiers 1–4)

## 1. Philosophy & Guiding Principles

EasyMourningReport utilizes a rigorous, multi-tiered end-to-end testing methodology designed around **opaque-box principles**:

1. **Opaque-Box Contract Verification**: Tests interact strictly with the application's external surface (HTTP API routes `/api/v1/*`, server-rendered export handlers `/admin/*`, authenticated cookie sessions, and file uploads/downloads). Tests do not couple to internal implementation details, private helper functions, or ephemeral ORM state.
2. **Behavioral Expected Outputs**: Every assertion is derived from authoritative specifications in `docs/PROJECT.md` and user requirements in `.agents/teamwork/ORIGINAL_REQUEST.md`.
3. **Deterministic Hermetic Isolation**: Every test scenario executes within its own isolated database instance and sandboxed storage root. Tests set up all prerequisite records, execute independently of run order, and perform complete resource teardown. The application database layer honours `TEST_DATABASE_URL` for PostgreSQL runs, while unit/E2E fixtures default to isolated temporary SQLite files.
4. **Strict Cache Suppression**: Tests run under `PYTHONDONTWRITEBYTECODE=1` and pytest's `-p no:cacheprovider -ra` flags. No `__pycache__`, `.pytest_cache`, or `*.pyc` artifacts are generated.
5. **Progressive Testability**: Fixtures dynamically support both the baseline session management and forward-compatible vertical slice architectures without code drift.

---

## 2. Feature Inventory to Test Mapping

The test suite systematically covers all application domains across four progressive tiers:

| Domain | Feature Scope | Tier 1 (Coverage) | Tier 2 (Boundaries) | Tier 3 (Combinations) | Tier 4 (Workloads) |
|---|---|---|---|---|---|
| **Auth** | Login, Session, RBAC, Logout, Throttling | 7 tests (`TC-AUTH-01..07`) | 6 tests (`TC-BND-AUTH-01..06`) | Paired with Store/Admin workflows | Multi-store session rotation |
| **Products** | Catalogue, Price Revisions, Soft-Archive, Hard-Delete, Restore | 7 tests (`TC-PROD-01..07`) | 7 tests (`TC-BND-PRC-01..07`) | Mid-period price change recalculation | Multi-product catalog expansion |
| **Stores** | Outlets CRUD, Account Linking, Renaming, Password Rotation, Archival | 6 tests (`TC-STORE-01..06`) | 6 tests (`TC-BND-DUP-01..06`) | Store renaming with historical report retention | 3-outlet enterprise operations |
| **Reports** | Monthly Drafts, Line Calculations, Submit, Lock/Unlock | 6 tests (`TC-REP-01..06`) | 7 tests (`TC-BND-PER-01..07`) | Product archival during active draft; unlock-resubmit | End-to-end monthly closing |
| **Audit** | Immutable Event Trail, Action Taxonomy, Filtered Queries | 6 tests (`TC-AUDIT-01..06`) | Integrated across mutations | Audit trail tracking across complex lifecycles | Full audit reconciliation |
| **Tunnel** | Cloudflare Tunnel Status, Autostart Toggle, Start/Stop Controls | 6 tests (`TC-TUNNEL-01..06`) | Invalid confirmation payloads, URL format checks | Admin-only permission enforcement | Sidecar and preference state |
| **Summary & Exports** | Matrix Aggregation, Excel Download, Excel Import, DB Backups | 6 tests (`TC-SUM-01..06`) | Filter bounds (`submitted_only`), extreme quantities | Cross-store aggregation with mixed drafts | Real-world multi-store close & backup |

E2E Test Cases Implemented: **82 tests** across Tiers 1–4. Full backend suite (unit, integration, and E2E): **285 tests**.

---

## 3. Test Architecture & Fixture Hierarchy

The test harness is implemented in `src/backend/tests/e2e/conftest.py` with standard pytest fixtures:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              e2e_env                                   │
│  - Creates temporary LEGKYI_DATA_DIR & LEGKYI_BACKUPS_DIR              │
│  - Isolated temp SQLite engine by default; TEST_DATABASE_URL optional  │
│  - Overrides get_db dependency in FastAPI app.dependency_overrides     │
│  - Seeds baseline Admin user ("e2e_admin"), Store ("E2E Store 1"),     │
│    Store user ("e2e_store1"), and baseline Product ("E2E Default Bread")│
│  - Clears sliding-window rate limit counters (_fails.clear())          │
│  - Teardown: clears overrides, disposes engine, purges temp folder     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           ▼                        ▼                        ▼
    ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
    │ anon_client  │         │ admin_client │         │ store_client │
    │ Unauthed     │         │ Authenticated│         │ Authenticated│
    │ TestClient   │         │ Admin session│         │ Store session│
    └──────────────┘         └──────────────┘         └──────────────┘
```

### Authentication & CSRF Handling
FastAPI's `same_origin_post_guard` enforces same-origin protection on mutating HTTP verbs (`POST`, `PUT`, `PATCH`, `DELETE`). The test harness automatically configures `base_url="http://testserver"` and injects `headers={"origin": "http://testserver"}` on all clients, ensuring seamless request dispatch while honoring the security boundary.

### Sliding-Window Rate Limit Management
Login rate-limiting (`app.core.ratelimit`) tracks sliding-window failures by `(pair, ip, login)`, `(ip)`, and `(login)`. The test fixture guarantees that `_fails` is wiped between tests, ensuring zero state pollution or false positives across test runs.

---

## 4. Tier 4 Real-World Workload Scenarios

The suite includes dedicated multi-stage workload tests simulating actual enterprise operations:

### Scenario 1: Multi-Store Monthly Close Cycle (`test_workload_end_to_end_monthly_close`)
1. **Outlet Provisioning**: Administrator sets up 3 independent stores ("Kyiv Flagship", "Lviv Market", "Dnipro Central").
2. **Catalog Definition**: Core items provisioned (Artisan Rye Bread @ 2.20, Pasteurized Milk @ 1.60, Cream Butter @ 4.50, Butter Croissant @ 1.25).
3. **Price Revisions**: Mid-period price changes executed for Rye Bread (2.20 → 2.50) and Milk (1.60 → 1.80).
4. **Decentralized Reporting**:
   - Store 1 submits sales with split price slots for repriced goods (10,600 cents).
   - Store 2 submits sales under revised price schedule (9,500 cents).
   - Store 3 enters draft (9,100 cents), which the administrator reviews and locks to `submitted`.
5. **Financial Matrix Reconciliation**: Monthly summary aggregated across stores and products, reconciling grand total (29,200 cents).
6. **Artifact Downloads**:
   - Monthly summary Excel (`/admin/summary.xlsx`) generated, downloaded, and parsed via `openpyxl`.
   - On-demand database snapshot (`/admin/backup/download`) downloaded and verified.
7. **Catalog Expansion**: Administrator uploads new Excel spreadsheet with seasonal products via `/api/v1/admin/products/import`.
8. **Compliance Audit**: Full verification of audit log records covering logins, pricing changes, store submissions, administrator locks, and backup exports.

### Scenario 2: High-Volume Catalog Stress (`test_workload_high_volume_catalogue_stress`)
- 20 distinct products generated with varying price scales.
- Store client enters quantities across all 20 rows and submits.
- Financial matrix recalculates 20 line sums and column totals without integer overflow.
- Summary Excel generated with 20 rows plus summary headers and footers.

---

## 5. Coverage Thresholds & Quality Gates

| Metric | Target | Verified Status |
|---|---|---|
| **Tier 1 Feature Coverage** | ≥5 test cases per feature area (≥35 total) | **44 test cases** (100% pass) |
| **Tier 2 Boundary Cases** | ≥5 test cases per feature (≥25 total) | **31 test cases** (100% pass) |
| **Tier 3 Combinations** | Multi-feature pairwise flows | **5 test cases** (100% pass) |
| **Tier 4 Realistic Workloads** | Complete monthly close simulation | **2 test cases** (100% pass) |
| **E2E Suite** | Comprehensive opaque-box coverage | **82 test cases** (100% pass) |
| **Non-E2E Backend Suite** | Unit and integration coverage | **203 test cases** (100% pass) |
| **Full Backend Suite** | All pytest tests | **285 test cases** (100% pass) |
| **Frontend Suite** | Vitest component/store/utility coverage | **37 test cases** (100% pass) |
| **Cache Suppression** | 0 cache/bytecode files generated | **Verified** (`NO BYTECODE OR CACHE`) |
| **Execution Performance** | Full E2E suite under 60 seconds | **~30s** execution time |
