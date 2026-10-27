# ADR 0002: Use uv for Python dependencies

- Status: Accepted
- Date: 2026-10-27

## Context

The repository previously used PDM for virtual environments, dependency installation, locking, Docker builds, Nix development setup, API-schema generation, and test commands. Maintaining multiple command conventions makes onboarding and deployment unnecessarily difficult.

## Decision

Use Astral's `uv` as the only Python dependency and environment manager.

- `pyproject.toml` is the source of direct runtime dependencies and the PEP 735 `dev` dependency group.
- `uv.lock` is the authoritative, committed dependency lockfile.
- `uv sync` installs the declared environment; `uv run` runs commands inside it.
- Use `uv run --locked` for verification and reproducible developer commands.
- Docker installs production dependencies with `uv sync --locked --no-dev --no-install-project`.
- `tool.uv.package = false` keeps this application repository from being treated as an installable Python distribution; the server runs from `backend/` as `python -m app`.
- `pdm.lock`, PDM-specific configuration, and PDM commands are removed.

## Operational rule

When dependency declarations change, regenerate and review `uv.lock`, then commit both files together. Release builds should use the committed lockfile; the Dockerfile's no-lock fallback exists only to make the one-time migration build possible and should not replace committing the lockfile.
