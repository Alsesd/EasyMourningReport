# syntax=docker/dockerfile:1.7
# Stage 1: Build client SPA
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Build Python environment & resolve production packages
FROM python:3.11-slim AS python-builder

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.10.0 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Preserve a checked-in uv.lock when present. During the one-time migration only,
# permit the image build to generate it if the checkout does not have one yet.
COPY . /tmp/repo/
RUN --mount=type=cache,target=/root/.cache/uv \
    cp /tmp/repo/pyproject.toml ./ && \
    if [ -f /tmp/repo/uv.lock ]; then \
      cp /tmp/repo/uv.lock ./ && uv sync --locked --no-dev --no-install-project; \
    else \
      uv lock && uv sync --locked --no-dev --no-install-project; \
    fi

# Stage 3: Minimal production runtime
FROM python:3.11-slim AS runtime

WORKDIR /app

# Install curl and ca-certificates for robust healthcheck probes and secure tunnel operations
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy official cloudflared binary directly for internal tunnel capability
COPY --from=cloudflare/cloudflared:latest /usr/local/bin/cloudflared /usr/local/bin/cloudflared

# Copy production virtualenv built with prefix /app/.venv
COPY --from=python-builder /app/.venv /app/.venv

# Copy runtime code, application entry point, and built SPA assets
COPY backend/app/ /app/app/
COPY --from=frontend-builder /app/backend/app/static/app/ /app/app/static/app/

# Create persistent storage directories with permissive defaults for Windows bind mounts
RUN mkdir -p /app/data /app/backups && chmod 777 /app/data /app/backups

# Declare persistent storage volumes for host device persistence
VOLUME ["/app/data", "/app/backups"]

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONIOENCODING=utf-8 \
    LEGKYI_DATA_DIR=/app/data \
    LEGKYI_BACKUPS_DIR=/app/backups \
    HOST=0.0.0.0 \
    PORT=8000

# Expose application port across Linux and Windows networks
EXPOSE 8000

# Enterprise healthcheck using native HTTP endpoint on port 8000
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:8000/" || exit 1

# Unified production entry point with enterprise startup diagnostics and banner
CMD ["python", "-m", "app"]
