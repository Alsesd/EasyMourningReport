# EasyMourningReport / Легкий звіт

A modular Go + React platform: organisations with multiple user accounts, roles and permissions, and feature modules (monthly store reports today, transport orders next), plus audit logs and controlled public access through a Cloudflare Tunnel. The whole application is one Go binary with the React app embedded; the database is SQLite. See [docs/architecture.md](docs/architecture.md) for the module contract and how to add a feature.

## Repository layout

```text
repo/
├── internal/                    # Go packages: config, store, core, platform, reports, transport,
│                                # system (tunnel, health), registry, web (HTTP), assets (embedded UI)
├── frontend/src/
│   ├── app/                     # shell: router, layout, login page, module registry
│   ├── platform/                # API client/types, auth, i18n, theme, access & settings pages
│   ├── ui/                      # reusable design-system primitives
│   └── modules/                 # reports/, transport/ (scaffold)
├── testdata/                    # frozen HTTP, money, pricing, XLSX, password and schema fixtures
├── cmd/server, cmd/smoke        # the program, and the post-build smoke test
├── .github/workflows/           # manual build, test and release of the single-file exe
├── .env.example                 # every setting, commented
├── README.md, CLAUDE.md         # everything else in docs/
├── docs/                        # API, architecture, ADRs, module notes, design docs, migration record
└── scripts/                     # build_go.sh (linux + windows binaries), e2e_test.py (browser smoke test)
```

## Local development

Requirements: Go 1.26+, Node.js 22.22.2+ and npm. (`uv` is only needed to run the browser smoke test script.)

```bash
cd frontend && npm ci && npm run build   # writes internal/assets/static/app/, which the binary embeds
cd .. && go run ./cmd/server             # http://127.0.0.1:8000
```

The server binds to `127.0.0.1:8000` by default; `HOST` and `PORT` override that. A first start creates `reports.db` and `secret.key` in the data folder (next to the executable when writable, else the per-user data folder; `LEGKYI_DATA_DIR` overrides) and prints the first administrator password once (`ADMIN_PASSWORD` sets it; `DEMO=1` also adds demo divisions). A new database contains only that administrator: no divisions, no other roles, no data; passwords need 8+ characters with small and capital letters and a digit.

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

## Single-file Windows program

`bash scripts/build_go.sh` (needs Go, Node and curl; works from Linux or macOS) writes `dist/legkyi.exe` (Windows) and `dist/legkyi` (Linux). Each is **one file** that contains the web UI, the PWA files and `cloudflared` (a pinned release, downloaded once and checked by SHA-256, Apache-2.0, see `dist/NOTICE.txt`).

Requires **64-bit Windows 10 or later** (the Go runtime needs an API that Windows 7/8 lack; 32-bit Windows is not built). Copy `legkyi.exe` to any writable folder and start it. It creates everything **in that same folder**:

| File | What |
|---|---|
| `.env` | optional settings, you create it (see below) |
| `reports.db` (+ `-wal`, `-shm`) | the database |
| `secret.key` | session signing key (keep it; deleting it signs everyone out) |
| `backups/` | verified database backups (every `BACKUP_EVERY_MIN`, at start and at exit) |
| `tunnel/` | the extracted `cloudflared-<version>.exe`, `cloudflared.log`, and a token saved from the admin page |
| `.tunnel-enabled`, `.tunnel-default-applied` | tunnel autostart markers |

On start it opens the database, takes a backup, starts the web server on `http://127.0.0.1:8000` and starts the Cloudflare Tunnel. **The first start prints the administrator login and password in the console window once** (set `ADMIN_PASSWORD` in `.env` to choose it). Close the window or press Ctrl+C to stop: the tunnel is stopped, a final backup is taken. If the program cannot start (for example the port is busy) the window waits for Enter so the message can be read.

`.env` next to the exe (Notepad is fine: UTF-8, UTF-8 with BOM, UTF-16 and Windows line endings are all read):

```env
ADMIN_PASSWORD=Choose-a-pass1
TUNNEL_TOKEN=eyJ...            # your Cloudflare named-tunnel token: a stable public address
PUBLIC_URL=https://zvit.example.com
PORT=8000
```

Without `TUNNEL_TOKEN` the program opens a temporary Quick Tunnel and prints its `trycloudflare.com` address when ready (it changes on every start). With `TUNNEL_TOKEN` it runs your named tunnel; variables already set in the Windows environment win over `.env`. `TUNNEL_ENABLED=0` keeps the tunnel off; after the first start the on/off choice in **Адміністрування → Система** is remembered. `cloudflared` always stops with the program, even when it is killed from Task Manager (Windows job object).

Notes: the file is not code-signed, so Windows SmartScreen may warn on first start («More info → Run anyway») and some antivirus tools inspect the unpacked `cloudflared`. Put the program in a folder you can write to (not `C:\Program Files`); otherwise data goes to `%LOCALAPPDATA%\LegkyiZvit` and a warning is printed.

## Upgrading from earlier releases

The Go server opens existing databases from the Python releases unchanged (same file, same schema, same password hashes). It does **not** carry the old upgrade code: a database must already have been started once by the last Python release (commit `92564ef`, which migrated the single-admin layout to organisations and roles). Otherwise start-up stops with a message saying so. Everyone has to sign in once more after the switch because the session mechanism changed. **Rolling back to the Python release means restoring the backup taken before the switch**: passwords upgraded by Go (on sign-in) use a newer hash format the Python release cannot read.

## Public access (Cloudflare Tunnel)

Open **Адміністрування → Система → Публічний доступ**. Without a token the app opens a temporary Quick Tunnel and shows its `trycloudflare.com` address. With a Cloudflare tunnel token (pasted there, or `TUNNEL_TOKEN` in `.env`) it runs your named tunnel; set `PUBLIC_URL` to show its address. `TUNNEL_ENABLED=0` keeps the tunnel off at start-up regardless of the saved preference.

## Power cuts and the database

SQLite runs inside the app and needs no server. Each committed change is flushed to disk (`synchronous=FULL`), so a power cut loses no saved report. On local disks the database uses WAL mode; on shared folders (Docker Desktop host folders, network shares) it falls back to the classic rollback journal, which is safe there. Override with `SQLITE_JOURNAL_MODE=wal|delete`. Every start runs an integrity check, and every backup is verified. The reasoning, with load-test numbers, is in [ADR 0003](docs/adr/0003-keep-sqlite.md).

## Build it yourself (any Linux machine, WSL, Termux)

One command builds both parts (web UI, then the Go program with the UI and cloudflared embedded) for the machine you are on:

```bash
bash scripts/build.sh      # -> dist/legkyi (one file)
```

It needs `go` 1.26+, `node`/`npm` 22+ and `curl`. In Termux: `pkg install git golang nodejs`, clone the repo, run the script, then `ADMIN_PASSWORD=Choose-a-pass1 ./dist/legkyi` and open `http://127.0.0.1:8000`. The script detects Android/Termux and ARM, and warns if your Go is older than the pinned patch release (the build still works; run `pkg upgrade golang` to get the newest fixes). `bash scripts/build_go.sh` is the release build for all platforms (Windows x64, Linux x64, Linux ARM64).

## Android (Termux), prebuilt

Download `legkyi-linux-arm64` from the latest release, then:

```bash
chmod +x legkyi-linux-arm64
ADMIN_PASSWORD=Choose-a-pass1 ./legkyi-linux-arm64
```

cloudflared is inside the file, but that copy is a generic Linux build and **cannot look up DNS on Android** (Termux has no `/etc/resolv.conf`), so the tunnel fails with `lookup ... on [::1]:53: connection refused`. On Termux install the Android build once and the program picks it up automatically (it is preferred over the bundled copy), for the temporary address and for `TUNNEL_TOKEN` alike:

```bash
pkg install cloudflared
```

Run `termux-wake-lock` so Android does not pause the app, and keep the file in Termux's home folder. The first start prints the administrator password once in the console; change it under «Налаштування» (do not share that output).

## Releasing

Releases are cut by hand: GitHub → **Actions → Release exe → Run workflow**, enter the tag (for example `Soup.V6`). The workflow (`.github/workflows/release.yml`):

1. runs frontend lint, typecheck and tests, Go vet and tests;
2. builds `legkyi.exe` and the Linux binary with `scripts/build_go.sh` (UI and a SHA-256-checked cloudflared inside);
3. tests the Linux binary (`cmd/smoke`, with and without the tunnel process) and in a real browser (`scripts/e2e_test.py`);
4. downloads `legkyi.exe` on a **Windows runner** and runs `cmd/smoke` there, including a forced kill that must also stop cloudflared;
5. only if everything passed (and "publish" is ticked) creates the GitHub release with `legkyi.exe`, `legkyi`, `SHA256SUMS.txt` and `NOTICE.txt`.

The same checks run locally:

```bash
bash scripts/build_go.sh                       # builds dist/legkyi.exe and dist/legkyi
go run ./cmd/smoke -exe dist/legkyi            # starts it in an empty folder and checks it (add -tunnel for cloudflared)
CHROMIUM_PATH=/opt/pw-browsers/chromium LEGKYI_E2E_BINARY=dist/legkyi uv run scripts/e2e_test.py   # browser test
```

See [Architecture](docs/architecture.md), [REST API](docs/API.md), [security notes](docs/security.md), [UX contract](docs/ux-contract.md), [design system](docs/design-system.md) and the module notes in `docs/modules/` before making structural changes. The history of the Python-to-Go port is in [docs/migration/](docs/migration/) and [ADR 0004](docs/adr/0004-port-backend-to-go.md).
