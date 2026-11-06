# Architecture

One Go process (`cmd/server`) serves the REST API and the compiled React app, which is embedded in the binary. The code is split into a **platform** that every feature uses and **feature modules** that each live in one package on the backend and one folder on the frontend. Adding a feature means adding those two and one line in each registry. The core is not edited.

```text
cmd/server/main.go         # entry point: config, schema, bootstrap, backups, tunnel, HTTP server, shutdown
internal/
├── config/                # environment, data/backup folder resolution, journal mode
├── store/                 # SQLite open (pragmas, reader/writer pools), schema/fresh.sql, backups
├── core/                  # the Module contract (permissions, audit actions, grants, seed, overview)
├── platform/              # accounts rules, principal and permissions, bootstrap (roles, first admin), passwords
├── reports/               # feature module: catalogue, price history, money, XLSX import/export, seed
├── transport/             # transport orders (also a template for new modules)
├── system/                # cloudflared supervisor and database health
├── update/                # self-update from GitHub Releases (check, verify, swap, restart)
├── registry/              # platform + installed modules (the only package that imports modules)
├── web/                   # HTTP: router, sessions, CSRF, rate limit, client IP, handlers
└── assets/                # embedded static/ (PWA files) and static/app/ (the Vite build)

frontend/src/
├── app/                   # shell: App.tsx, layout, login page, routing, registry.ts
├── platform/              # API client, auth, i18n, theme, offline drafts, module contract,
│                          # admin/ (the «Адміністрування» hub), access/ (users, orgs, roles),
│                          # account/ (account menu, own password), audit/, system/
├── ui/                    # design-system primitives
└── modules/
    ├── index.ts           # installedModules = [reportsModule, transportModule]
    ├── reports/           # module.tsx, api.ts, permissions.ts, i18n.ts, pages/, settings/, components/
    └── transport/         # transport orders
```

## Module contract

**Backend** (`internal/core/module.go`). A module exposes `var Module = core.Module{...}` from its package with:

| Field | Purpose |
|---|---|
| `Name`, `Title` | Identifier and Ukrainian title |
| `Permissions` | `core.Permission{Code, Label, Scope, Description}`; they appear in the role editor automatically |
| `AuditActions` | Audit action names offered as log filters |
| `DefaultGrants` | Permissions a built-in role receives, e.g. `{"store": {reports.Submit}}` |
| `OrganisationUsage` | Records held per organisation id. An organisation with data in any module is archived instead of deleted |
| `Seed` | Demo data for `DEMO=1` on an empty database |
| `Overview` | Figures for the «Адміністрування» overview, filtered by the caller's permissions |

A module lists its endpoints in `core.Module.Routes` (`internal/<module>/http.go`: `core.Route{Method, Path, Codes, Member, Handler}`); `internal/web/modules.go` registers each one behind `a.authed(codes, ...)` / `a.member(codes, ...)`, so a module cannot add an unprotected route. Handlers receive a `core.Caller` and `core.Services` (the shell builds both). The module is listed in `internal/registry/registry.go`.

**Frontend** (`src/platform/modules.ts`). A module exports an `AppModule` from `module.tsx` with:

- `routes`: shell pages relative to `/admin`, or standalone absolute paths;
- `nav` items;
- `admin` sections, each with `id`, `label`, `description`, `group` (`access`, `catalog`, `system` or `activity`), `icon`, `permissions` and `component`;
- `landing` pages with priorities.

Every entry lists the permission codes that unlock it. The shell builds routing, navigation, the «Адміністрування» hub (`/admin/manage`, one URL per section: `/admin/manage/<id>`) and the post-login redirect from these lists. The hub's menu item appears for anyone who can open at least one section. Sections receive a `notify(text, kind)` prop for the hub's shared status message.

**Boundaries:**

- A module package may import `core`, `store` and `platform`, never another module.
- `core`, `store`, `platform` and `web` never import a module package. `registry` and `cmd/server` are the exceptions.
- On the frontend, `platform/` and `ui/` never import `modules/` or `app/` (enforced by `frontend/src/app/registry.test.ts`). Platform pages receive the composed registry through `ModuleRegistryContext`.

### Adding a module, e.g. transport orders

1. Backend: copy `internal/transport` to a new package, declare the permissions and `core.Module`, add the tables to `internal/store/schema/fresh.sql` and an idempotent create step in `internal/store/schema.go`, write repo functions and HTTP handlers in the module package and list them in `Module.Routes` (`Codes`, `Member`). Scope organisation data with the principal's organisation. Add tests, and list the module in `internal/registry/registry.go`.
2. Frontend: add pages under `src/modules/<name>/pages/` and list them in `module.tsx` and `src/modules/index.ts`. Mirror the permission codes in `permissions.ts`.
3. Update `src/platform/api/schema.d.ts` and `types.ts` by hand, and `docs/API.md`.
4. Grant the new permissions to roles in «Адміністрування → Ролі». Optionally set `DefaultGrants` for built-in roles.

## Accounts and access

- **Organisation**: a customer-side unit. Every store from earlier releases became one. It can have many users. Archived organisations keep their data, and their users cannot sign in.
- **User**: `organisation_id = NULL` means platform staff, who act across organisations. Users can be disabled (`active = false`).
- **Role**: a named, plain set of permissions (any codes; the stored `scope` is legacy and informational). A role can be shared by all divisions or limited to one. A user may hold several roles. The user's division is the scope of what they see; seeing other divisions needs a permission that says so (for example `transport.orders.manage`, `reports.review`).
  - Built-in **Адміністратор** (`platform_admin`) and **Адміністратор організації** (`org_admin`) always hold every permission of their scope, including permissions of modules installed later.
  - Built-in **Магазин** (`store`) is editable and starts with `reports.submit`.
- **Effective permissions** are the union of what the user's roles grant (`internal/platform/principal.go`); the built-in administrator holds every platform-level code.
- **Escalation guards**: organisation managers (`org.users.manage`) only see and edit their own organisation, and only hand out roles whose permissions they hold themselves. The last active platform administrator cannot be disabled, demoted or deleted.

| Permission | Scope | Unlocks |
|---|---|---|
| `platform.organisations.manage` | platform | Organisations |
| `platform.users.manage` | platform | All user accounts |
| `platform.roles.manage` | platform | Role editor |
| `platform.audit.view` | platform | Audit log |
| `platform.system.manage` | platform | Backups, database health, Cloudflare Tunnel, program updates |
| `org.users.manage` | organisation | Own organisation's users |
| `reports.submit` | organisation | Fill and submit own monthly report |
| `reports.review` | platform | Summary, report list/detail, lock/unlock, Excel |
| `reports.catalog.manage` | platform | Products and prices |
| `reports.settings.manage` | platform | «По розрахунку» per organisation |
| `transport.orders.create` | organisation | Place transport orders, edit or cancel until the dispatcher replies |
| `transport.orders.view_all` | platform | Read-only: see all orders and the history |
| `transport.orders.manage` | platform | Handle orders: see all, read the history, set the reply status |

## Persistence and schema

SQLite runs inside the app process (decision and load-test numbers: [ADR 0003](adr/0003-keep-sqlite.md)). Every connection uses `synchronous=FULL`, foreign keys, and WAL on local disks or the rollback journal on shared folders (`internal/store/open.go`, `internal/config`). `LEGKYI_DATA_DIR` and `LEGKYI_BACKUPS_DIR` set the persistent folders; Compose bind-mounts them from `./app_storage/data` and `./app_storage/backups`. A single writer connection runs each mutation in one immediate transaction; reads use a separate pool.

Backups (`internal/store/backup.go`) run inside the app: at start-up, every `BACKUP_EVERY_MIN` minutes when the **data** changed, on demand, and at shutdown. "Changed" is a content fingerprint of every table except the volatile ones (`user_sessions`, `session_devices`, `passkeys`, `notifications`), so sign-ins, token rolling and read marks alone never make a copy; right after start-up, before there is a fingerprint, the file times decide. Each copy is a verified single file (`VACUUM INTO` plus `quick_check`) named `reports-YYYYMMDD-HHMMSSZ[-tag].db` in **UTC** (older names without `Z` are read as local time), ordered by that time. The newest `BACKUP_KEEP` regular copies are kept; download snapshots (`-snapshot`, taken by every download) have their own cap of 10 and never push regular copies out. Start-up runs `PRAGMA quick_check` (logged only).

Notifications (`internal/platform/notifications.go`, `internal/web/notifications.go`): a Go-owned `notifications` table, one row per recipient, written in the same transaction as the event (new/cancelled/bumped transport orders, status replies, submitted reports). Recipients are resolved by effective permission code, so the shell never names a module. `RunScheduler` (a minute loop started by `cmd/server`) sends the reminder to desks without an order for tomorrow at `REMINDER_AT` (default `14:30`, `off` disables) in `APP_TIMEZONE` (default `Europe/Kyiv`; zone data is embedded), idempotent per user and day by a dedupe key, and prunes old rows (read: 30 days, any: 180). The UI polls the bell every 20 s and raises device notifications through the service worker while the app is open.

**Web Push** (reaches a closed app; `internal/platform/webpush.go`, `internal/web/push.go`, `sw.js`): stdlib-only RFC 8030/8291 (aes128gcm, checked against the RFC's worked example in a test) and RFC 8292 (VAPID). The key pair lives in `<data>/vapid.key` (0600, created once, never regenerated: a new key would invalidate every subscription) or `VAPID_PRIVATE_KEY`; it is a file and not a table so a backup never holds a key that can send as this server. `VAPID_SUBJECT` is the contact URL pushed services see (default: the project's GitHub URL; never a personal e-mail). Subscriptions (`push_subscriptions`, Go-owned) belong to whoever is signed in on that browser: re-sent on every signed-in load, deleted before sign-out, reassigned when another person registers the same browser. The server POSTs only to https endpoints on a push-service allowlist (SSRF guard). Delivery is never inside a write transaction: `RunPushDispatcher` polls every 3 s for notifications with `pushed_at = 0`, claims them, then sends; rows older than 10 minutes are retired unsent so a restart or the new column never floods phones with history; a 404/410 deletes the subscription. Works in Chrome, Edge and Firefox (desktop and Android); on iPhone only for the app added to the Home Screen (iOS 16.4+). Needs HTTPS (the tunnel) and outbound internet to the push services.

First sign-in on a device: `DeviceSetup` (one dialog, never stacked with the biometric offer) asks to enable notifications and to install the app; each button calls the browser straight from its click, because browsers only show those prompts after a tap. "Later" asks again after a week. Installing always shows the browser's own confirmation.

Schema: `internal/store/schema/fresh.sql` holds the DDL of a fresh database, and any missing table is created on start. The migrations of the Python releases are not ported. Start-up checks that `schema_migrations` already contains `platform.0001_organisations_and_roles` and the reports migrations; a database that predates them must first be started once with the last Python release (commit `92564ef`). `testdata/schema/*.sql` are snapshots of fresh and legacy-migrated databases, and `internal/store/store_test.go` verifies Go leaves them unchanged and that a fresh Go database has the same schema.

Distribution: `scripts/build_go.sh` builds the Vite app, then one Go binary per OS with the UI and a pinned `cloudflared` embedded (`-tags bundle`). `.github/workflows/release.yml` runs it, tests the result and publishes `legkyi.exe`.

## Public access

`internal/system/tunnel.go` runs `cloudflared` as a child process of the app and reads its status from cloudflared's local metrics endpoint (`127.0.0.1:20241`). With a token (saved from the UI or `TUNNEL_TOKEN`) it runs a named tunnel; without one, a Quick Tunnel. The app trusts `X-Forwarded-For` only from `127.0.0.1` (`FORWARDED_ALLOW_IPS`), i.e. from its own cloudflared, so client addresses in the audit log and the sign-in rate limit cannot be spoofed.

## Verification commands

```bash
# backend
go vet ./cmd/... ./internal/... && go test ./cmd/... ./internal/...

# frontend
cd frontend && npm run lint && npm run typecheck && npm test && npm run build

# browser smoke test against the real binary
go build -o dist/legkyi ./cmd/server && uv run scripts/e2e_test.py
```
