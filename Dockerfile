# Stage 1: Build client SPA
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Build Python environment & resolve production packages
FROM python:3.11-slim AS python-builder

WORKDIR /app

RUN pip install --no-cache-dir pdm

COPY pyproject.toml pdm.lock* ./
RUN pdm config venv.in_project true && \
    pdm install --prod --no-editable

# Stage 3: Minimal production runtime
FROM python:3.11-slim AS runtime

WORKDIR /app

# Install curl for robust healthcheck probes
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy production virtualenv built with prefix /app/.venv
COPY --from=python-builder /app/.venv /app/.venv

# Copy runtime code, application entry point, and built SPA assets
COPY app/ /app/app/
COPY run.py /app/run.py
COPY --from=frontend-builder /app/app/static/app/ /app/app/static/app/

# Create persistent storage directories
RUN mkdir -p /app/data /app/backups

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

# Enterprise healthcheck using native HTTP endpoint with dynamic PORT support
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/" || exit 1

# Unified production entry point with enterprise startup diagnostics and banner
CMD ["python", "run.py"]
