# ADR 0001: Separate platform code, feature modules, and deployment assets

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

The backend, frontend shell, generic browser capabilities, domain pages, deployment assets, tests, and historical planning docs had mixed responsibilities or used obsolete paths. The previous backend `run.py` and `app.__main__` were competing launchers, while `app.main` mixed composition with lifecycle and exception handling. Frontend API access and tunnel operations also lived directly in pages.

## Decision

1. Place Python application code and its tests under `backend/app/`.
2. Keep `backend/app/main.py` composition-only and use `python -m app` as the sole server entry point.
3. Separate form errors, period/money helpers, server-rendered fallback helpers, lifecycle, and HTTP exception handling into focused backend modules.
4. Organize frontend code into `app/`, `platform/`, `ui/`, and feature modules under `modules/`.
5. Put production Docker and Compose files under `deploy/`; retain a root Compose include as a compatibility affordance.
6. Keep the local SQLite database as the runtime default; offer explicit database-transfer tooling without claiming that application PostgreSQL support is already enabled.
7. Remove the obsolete GitHub Actions workflow from this snapshot as requested; local checks remain documented.

## Consequences

- Imports and local commands now assume `backend/` is the Python package root.
- Frontend imports continue to use the `@/` alias, now mapped to the reorganized `src/` tree.
- Runtime data stays in the same host-mounted `data/` and `backups/` directories under Compose.
- Adding a new feature should use `scripts/new_module.py` and document its boundaries in `docs/modules/`.

Deployment keeps the existing root `./data` and `./backups` bind mounts while running periodic SQLite snapshots in a dedicated sidecar that reuses the application’s online-backup implementation.
