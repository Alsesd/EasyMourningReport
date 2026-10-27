# REST API v1

The web UI for administration and store reports uses a versioned, same-origin JSON API. Existing session-cookie authentication is reused; there are no bearer tokens, duplicated identities, or new auth dependencies.

## Contract

- Base path: `/api/v1`
- Requests and responses use JSON except binary exports.
- Prices and calculated amounts are integer **cents** in DTOs. Send editable price values as strings (for example `"12.50"`) so decimal parsing remains server-side and supports comma decimals.
- Product DTO `month_prices_cents` is the full in-month timeline: the price at the start of the month followed by every price change, including a return to an earlier amount. `price_history` contains every saved history event, in chronological/sequence order.
- Every resource response is a DTO, not a serialized SQLModel/ORM instance. Password hashes and persistence-only fields are never exposed.
- The browser uses the existing signed session cookie. Unauthenticated requests return `401`, role violations return `403`, missing resources return `404`, conflicting state returns `409`, and invalid payloads return `422`.
- Unsafe methods (POST, PUT, PATCH, DELETE) require a same-origin `Origin` or `Referer` header. Browser `fetch` supplies the origin automatically for these requests.
- Authentication is performed exclusively through `POST /api/v1/auth/login`; the client uses the signed session cookie for subsequent JSON requests. CSRF failures return JSON.

## Endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/session` | Signed-in user | Current identity and period |
| GET | `/admin/products?period=YYYY-MM` | Admin | Product DTOs, usage counts, the current-month price timeline, and full price history |
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
| GET | `/admin/tunnel` | Admin | Public tunnel status and live URL |
| POST | `/admin/tunnel` | Admin | Enable public tunnel |
| PUT | `/admin/tunnel/autostart` | Admin | Toggle tunnel autostart |
| DELETE | `/admin/tunnel` | Admin | Disconnect live tunnel |
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

Repeat the same update endpoint when the price changes again during the same month. Each distinct change is appended to the history using period keys `YYYY-MM`, `YYYY-MM_1`, `YYYY-MM_2`, and so on; previous values are not overwritten. A no-op (the price is already current) is ignored. Returning to an earlier amount is still recorded as a history event.

The admin UI timeline shows each event, including repeated amounts. Report DTOs deliberately offer one input per **unique price amount**, because quantities are stored by product and unit price. For example, price changes `10.00 → 12.00 → 15.00 → 12.00` keep all four events in history but offer the report price choices `10.00, 12.00, 15.00`. Previously saved report quantities are not recalculated.

Save the full set of editable report quantities. The server revalidates every product/price pair against its own history, preserves quantities for inactive or archived products, and blocks further edits after submission:

```http
PUT /api/v1/store/reports/2026-10
Content-Type: application/json

{"action":"draft","quantities":[{"product_id":12,"price_cents":2600,"quantity":4}]}
```

## Client rendering

The admin catalogue/store view, store report editor, admin report list/detail, monthly summary and audit log are React 18 + TypeScript features using TanStack Query. They fetch DTOs, render loading/error states, and use JSON writes. The FastAPI server handles session entry/exit through `/api/v1/auth/login` and `/api/v1/auth/logout` and streams binary Excel exports; the built SPA is served from `src/backend/app/static/app/`.


## Local development and runtime secrets

From the repository root, install the locked dependencies and run the app:

```bash
uv sync
docker volume create easymourningreport_pgdata 2>/dev/null || true
docker compose up -d db
uv run python -m app
```

Open `http://127.0.0.1:8000`. Stop the local development server with Ctrl+C; the PostgreSQL Compose service keeps running (stop it with `docker compose stop db`). The first run creates the PostgreSQL schema, writes a `secret.key` in the data directory, and prints the generated administrator password to the terminal.

`secret.key` is a randomly generated application secret used by Starlette's session middleware to sign session cookies. Keep it private, exclude it from source control, and back it up together with the PostgreSQL volume. Losing or changing it invalidates existing signed sessions, so users must sign in again; it does not reset their stored passwords. You may set a stable secret using the `SECRET_KEY` environment variable instead.
