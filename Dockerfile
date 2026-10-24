# Stage 1: Build environment & resolve production packages
FROM python:3.11-slim AS builder

WORKDIR /app

RUN pip install --no-cache-dir pdm

COPY pyproject.toml pdm.lock* ./
RUN pdm config venv.in_project true && \
    pdm install --prod --no-editable

# Stage 2: Minimal runtime
FROM python:3.11-slim

WORKDIR /app

# Copy production virtualenv built with prefix /app/.venv
COPY --from=builder /app/.venv /app/.venv

# Copy only necessary runtime code
COPY app/ /app/app/

# Persistent data lives in a mounted volume
RUN mkdir -p /app/data /app/backups

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LEGKYI_DATA_DIR=/app/data \
    HOST=0.0.0.0 \
    PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/')" || exit 1

# Direct Uvicorn execution via module invocation with proxy support for tunnel
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
