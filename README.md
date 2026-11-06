# EasyMourningReport / Легкий звіт

A modular Go + React platform: organisations with multiple user accounts, roles and permissions, and feature modules (monthly store reports today, transport orders next), plus audit logs and controlled public access through a Cloudflare Tunnel. The whole application is one Go binary with the React app embedded; the database is SQLite. See [docs/architecture.md](docs/architecture.md) for the module contract and how to add a feature.

## Repository layout

```text
repo/
├── cmd/server/                  # the single entry point
├── internal/                    # Go packages: config, store, core, platform, reports, transport,
│                                # system (tunnel, health), registry, web (HTTP), assets (embedded UI)
├── frontend/src/
│   ├── app/                     # shell: router, layout, login page, module registry
│   ├── platform/                # API client/types, auth, i18n, theme, access & settings pages
│   ├── ui/                      # reusable design-system primitives
│   └── modules/                 # reports/, transport/ (scaffold)
├── testdata/                    # frozen HTTP, money, pricing, XLSX, password and schema fixtures
├── deploy/                      # production Dockerfile, Compose and env example (one container)
├── docs/                        # API, architecture, ADRs, module notes, design docs, migration record
└── scripts/                     # build_go.sh (linux + windows binaries), e2e_test.py (browser smoke test)
```

## Local development

Requirements: Go 1.26+, Node.js 22.22.2+ and npm. (`uv` is only needed to run the browser smoke test script.)

```bash
cd frontend && npm ci && npm run build   # writes internal/assets/static/app/, which the binary embeds
cd .. && go run ./cmd/server             # http://127.0.0.1:8000
```

The server binds to `127.0.0.1:8000` by default; `HOST` and `PORT` override that. A first start creates `reports.db` and `secret.key` in the data folder (next to the executable when writable, else the per-user data folder; `LEGKYI_DATA_DIR` overrides) and prints the first administrator password once (`ADMIN_PASSWORD` sets it; `DEMO=1` also adds demo stores).

Backend tests (use these package paths, `./...` would descend into `node_modules`):

```bash
go vet ./cmd/... ./internal/... && go test ./cmd/... ./internal/...
```

For UI work run the Vite dev server next to the Go server:

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`. Vite serves the app there (deep links work) and forwards `/api`, `/healthz`, `/manifest.webmanifest` and the static icons to `http://127.0.0.1:8000`; set `BACKEND_URL` to use another backend port. To check the frontend:

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

Release binaries for Linux and Windows (data next to the `.exe`): `bash scripts/build_go.sh` writes `dist/legkyi` and `dist/legkyi.exe`.

## Upgrading from earlier releases

The Go server opens existing databases from the Python releases unchanged (same file, same schema, same password hashes). It does **not** carry the old upgrade code: a database must already have been started once by the last Python release (commit `92564ef`, which migrated the single-admin layout to organisations and roles). Otherwise start-up stops with a message saying so. Everyone has to sign in once more after the switch because the session cookie format changed.

## Docker deployment

Copy the env template, review its values, and start Compose from the repository root:

```bash
cp deploy/.env.example .env
docker compose up -d --build
```

The root `compose.yaml` is a small wrapper that includes `deploy/compose.yaml`, so the usual `docker compose up -d` works from the repository root. Use Docker Compose v2.24 or newer (it uses `include` and optional `env_file`).

Everything runs in **one container**, `mourningreport-app`: the web server, the SQLite database, periodic backups and the Cloudflare Tunnel (`cloudflared` is started and supervised by the app). The container publishes the configured host port (default `8000`) and keeps its data in bind-mounted host folders:

| Host folder | In the container | Contents |
|---|---|---|
| `./app_storage/data` | `/app/data` | `reports.db`, `secret.key`, tunnel token |
| `./app_storage/backups` | `/app/backups` | verified SQLite backups |

**Do not delete or rename those folders during an update.** To update, back up both folders, pull the new source, then run:

```bash
docker tag easymourningreport:local easymourningreport:previous 2>/dev/null || true   # keep the old image for rollback
docker compose up -d --build --remove-orphans
```

**Rolling back from the Go release to the Python one:** stop the container, restore the pre-update copy of `app_storage/`, and check out commit `92564ef` (the last Python release) or run the `easymourningreport:previous` image. Do not run the old release on data that the Go release has written after the switch without a backup, and keep the pre-switch backup until you are confident.

`--remove-orphans` removes the `mourningreport-backup` container that older releases ran next to the app; backups now run inside the app (every `BACKUP_EVERY_MIN` minutes when something changed, plus at start-up and shutdown, keeping `BACKUP_KEEP` copies). Follow the logs with `docker compose logs -f app`; `GET /healthz` is the container health probe.

Useful environment values (`ADMIN_PASSWORD`, `SECRET_KEY`, `DEMO`, `PORT`, `PUBLIC_URL`, `TUNNEL_ENABLED`, `TUNNEL_TOKEN`, `BACKUP_EVERY_MIN`, `BACKUP_KEEP`, `SQLITE_JOURNAL_MODE`, `COOKIE_SECURE`, `FORWARDED_ALLOW_IPS`) are documented in `deploy/.env.example`. Keep `.env`, `secret.key`, the database and backups out of version control.

### Public access (Cloudflare Tunnel)

Open **Адміністрування → Система → Публічний доступ**. Without a token the app opens a temporary Quick Tunnel and shows its `trycloudflare.com` address. With a Cloudflare tunnel token (pasted there, or `TUNNEL_TOKEN` in `.env`) it runs your named tunnel; set `PUBLIC_URL` to show its address. `TUNNEL_ENABLED=0` keeps the tunnel off at start-up regardless of the saved preference.

### Power cuts and the database

SQLite runs inside the app and needs no server. Each committed change is flushed to disk (`synchronous=FULL`), so a power cut loses no saved report. On local disks the database uses WAL mode; on shared folders (Docker Desktop host folders, network shares) it falls back to the classic rollback journal, which is safe there. Override with `SQLITE_JOURNAL_MODE=wal|delete`. Every start runs an integrity check, and every backup is verified. The reasoning, with load-test numbers, is in [ADR 0003](docs/adr/0003-keep-sqlite.md).

## Project scripts

Run the browser end-to-end check against the real binary (needs Playwright via `uv`; `CHROMIUM_PATH` reuses an installed Chromium):

```bash
go build -o dist/legkyi ./cmd/server
uv run scripts/e2e_test.py
```

See [Architecture](docs/architecture.md), [REST API](docs/API.md), and the module notes in `docs/modules/` before making structural changes. The history of the Python-to-Go port is in [docs/migration/](docs/migration/) and [ADR 0004](docs/adr/0004-port-backend-to-go.md).
