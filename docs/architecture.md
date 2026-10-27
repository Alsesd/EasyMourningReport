# Architecture

## Runtime composition

The supported server launcher is `python -m app`, run with `backend/` as the working directory. It loads the optional repository `.env`, prints the storage/startup banner, and starts Uvicorn. `app.main:app` remains the ASGI object path for Uvicorn, tests, and deployment integrations; `main.py` contains no server-start logic.

`backend/app/main.py` composes the application from:

- `core/lifecycle.py`: database bootstrap, seed data, startup/shutdown snapshots, and tunnel startup/shutdown; periodic backups run in the web process for non-sidecar deployments;
- `core/http_errors.py`: consistent JSON errors for API requests and HTML fallback handling;
- `core/security.py`: session secret and same-origin write guard;
- `routes/`: auth, PWA, administration, versioned API, and the final SPA catch-all;
- `core/paths.py`: runtime assets and persistent data paths.

The SPA fallback is registered after concrete routers so `/api/*`, `/static/*`, backup downloads, manifests, and service-worker endpoints are not shadowed by frontend routing. The Jinja2 fallback helpers now live in `core/web.py`; money and period helpers live in `core/periods.py`; form/input exceptions live in `core/errors.py`. The old mixed `core/ui.py` module is gone, but the small fallback templates remain intentional for error/offline behavior and legacy form endpoints.

## Frontend boundaries

- `app/` owns the application shell, providers, layout, login page, and route composition.
- `platform/` owns cross-cutting browser capabilities: the HTTP client and generated DTO types, session/auth context and route guards, and local offline drafts.
- `ui/` contains reusable design-system primitives and generic visual components.
- `modules/reports/` owns the report pages, feature API functions, feature-local Ukrainian strings, and UI tests.
- `modules/transport/` owns the API contract for starting, stopping, and monitoring the public tunnel. The existing admin settings screen consumes this API surface; its visual section can be split into a dedicated page when that warrants a separate user workflow.

Domain pages should call feature-owned `api.ts` functions rather than embed endpoint paths. Shared request mechanics belong in `platform/api/client.ts`. Generated OpenAPI types are in `platform/api/schema.d.ts` and aliases in `platform/api/types.ts`.

## Persistence and deployment

SQLite is the production default in this revision. Persistent files are resolved through `LEGKYI_DATA_DIR` and `LEGKYI_BACKUPS_DIR`, with explicit Compose bind mounts to host directories. By default, those mounts remain `./data` and `./backups` at the repository root, preserving the existing host paths. The migration script in `scripts/sqlite_to_postgres.py` is a data-copy utility; it does not constitute runtime PostgreSQL support or alter the running app's database URL.

`deploy/Dockerfile` builds the frontend and Python runtime in separate stages. `deploy/compose.yaml` defines the web app and a dedicated `backup` sidecar; root `compose.yaml` includes it with the repository root as the path base to preserve the conventional root command. The sidecar reuses `app.db.backup.backup_db`; `BACKUP_SIDECAR_ENABLED=1` disables the app process’s periodic loop to avoid duplicate schedulers. The app still takes startup, on-demand, and shutdown snapshots. Keep data and backup mounts unchanged when updating the image.

## Verification commands

```bash
# backend
uv run --locked pytest

# frontend
cd frontend && npm run lint && npm run typecheck && npm test -- --run && npm run build
```

No CI workflow is included in this repository snapshot; validation is run locally using the commands above.

