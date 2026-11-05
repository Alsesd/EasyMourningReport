# Transport module (scaffold)

**Backend:** `backend/app/modules/transport/` · **Frontend:** `frontend/src/modules/transport/`

Reserved for submitting and tracking transport orders. Today it registers its permissions, a `GET /api/v1/transport/status` endpoint, a «Транспорт» navigation item and a placeholder page, so it already appears in the role editor and navigation. It also serves as the template for new modules (see `docs/architecture.md` → *Adding a module*).

| Permission | Scope | Intended use |
|---|---|---|
| `transport.orders.create` | organisation | Members place orders for their organisation and see their statuses |
| `transport.orders.view_all` | platform | Staff see every organisation's orders |
| `transport.orders.manage` | platform | Staff accept orders and move them through statuses |

Suggested next step: a `TransportOrder` table with organisation, requested date/time, pickup, destination and notes, plus a `TransportOrderStatusChange` history table (`new → accepted → in_progress → done | cancelled`). Organisation members list and create their own orders. Staff with `manage` change status, and each change writes an audit entry.

The public-tunnel controls that once lived in `frontend/src/modules/transport/api.ts` are in `frontend/src/platform/system/` (Cloudflare Tunnel only; Tailscale support was removed).
