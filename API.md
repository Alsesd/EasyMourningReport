# REST API v1

The web UI for administration and store reports uses a versioned, same-origin JSON API. Existing session-cookie authentication is reused; there are no bearer tokens, duplicated identities, or new auth dependencies.

## Contract

- Base path: `/api/v1`
- Requests and responses use JSON except binary exports.
- Prices and calculated amounts are integer **cents** in DTOs. Send editable price values as strings (for example `"12.50"`) so decimal parsing remains server-side and supports comma decimals.
- Every resource response is a DTO, not a serialized SQLModel/ORM instance. Password hashes and persistence-only fields are never exposed.
- The browser uses the existing signed session cookie. Unauthenticated requests return `401`, role violations return `403`, missing resources return `404`, conflicting state returns `409`, and invalid payloads return `422`.
- Unsafe methods (POST, PUT, PATCH, DELETE) require a same-origin `Origin` or `Referer` header. Browser `fetch` supplies the origin automatically for these requests.
- Legacy HTML form routes remain registered for compatibility, but migrated admin/store actions use the JSON API. API CSRF failures also return JSON.

## Endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/session` | Signed-in user | Current identity and period |
| GET | `/admin/products?period=YYYY-MM` | Admin | Product DTOs, usage counts, current-month price choices, and price history |
| POST | `/admin/products` | Admin | Create product |
| POST | `/admin/products/import` | Admin | Bounded `.xlsx` import with a message DTO |
| PUT | `/admin/products/{id}` | Admin | Update name, price, and active state |
| DELETE | `/admin/products/{id}` | Admin | Archive products with report history; otherwise delete |
| POST | `/admin/products/{id}/restore` | Admin | Restore an archived product |
| GET | `/admin/stores` | Admin | Store DTOs and report counts |
| POST | `/admin/stores` | Admin | Create store and login |
| PUT | `/admin/stores/{id}` | Admin | Update store name/login |
| DELETE | `/admin/stores/{id}` | Admin | Archive stores with reports; otherwise delete |
| POST | `/admin/stores/{id}/restore` | Admin | Restore an archived store |
| PUT | `/admin/stores/{id}/password` | Admin | Reset store password |
| PUT | `/admin/password` | Admin | Change the current administrator password |
| GET | `/store/reports/{period}` | Store | Current report state and editable lines |
| PUT | `/store/reports/{period}` | Store | Save a report snapshot as a draft or submit it |
| GET | `/admin/reports?period=YYYY-MM` | Admin | Reports for all visible stores for a month, including missing submissions |
| GET | `/admin/reports/{id}` | Admin | Report detail |
| PATCH | `/admin/reports/{id}` | Admin | Lock/unlock by setting status |
| GET | `/admin/summary?period=YYYY-MM&submitted_only=false` | Admin | Summary DTO and totals |
| GET | `/admin/log-actions` | Admin | Valid audit action filter values |
| GET | `/admin/logs?login=&action=&limit=200` | Admin | Recent audit logs |

## Example requests

Create a product:

```http
POST /api/v1/admin/products
Content-Type: application/json

{"name":"Хліб","price":"25.50"}
```

Update a product:

```http
PUT /api/v1/admin/products/12
Content-Type: application/json

{"name":"Хліб","price":"26,00","active":true}
```

Save the full set of editable report quantities. The server revalidates every product/price pair against its own history, preserves quantities for inactive or archived products, and blocks further edits after submission:

```http
PUT /api/v1/store/reports/2026-10
Content-Type: application/json

{"action":"draft","quantities":[{"product_id":12,"price_cents":2600,"quantity":4}]}
```

## Client rendering

The admin catalogue/store view, store report editor, admin report list/detail, monthly summary and audit log are Alpine.js components. They fetch DTOs, update the DOM client-side, show loading/error states, and use JSON writes. Jinja renders the lightweight page shells and still handles login/logout and the binary Excel export. This keeps the change incremental and avoids introducing a frontend bundler into the portable Windows build.


## Local development and runtime secrets

From the repository root, install the locked dependencies and run the app without building an executable:

```bash
poetry install
poetry run python run.py
```

Open `http://127.0.0.1:8000`. Stop the server with Ctrl+C. The first run initializes the SQLite database, backups, and `secret.key`; the initial administrator password is printed to the terminal.

`secret.key` is a randomly generated application secret used by Starlette's session middleware to sign session cookies. It is not a Tailscale key and does not grant Tailscale access. Keep it private, exclude it from source control, and back it up alongside `reports.db`. Losing or changing it invalidates existing signed sessions, so users must sign in again; it does not reset their stored passwords. You may set a stable secret using the `SECRET_KEY` environment variable instead.

Tailscale auth keys are optional and only needed when enrolling a device without interactive browser login. Generate one in the [Tailscale Admin Console → Keys](https://login.tailscale.com/admin/settings/keys). Prefer one-off, short-lived keys; never commit one into this repository or hard-code it in `start.bat`. See the [official auth key guide](https://tailscale.com/docs/features/access-control/auth-keys).
