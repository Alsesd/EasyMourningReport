# syntax=docker/dockerfile:1.7
# Go build of the application (the Python image is deploy/Dockerfile). Build it under its own tag:
#   docker build -f deploy/go.Dockerfile -t easymourningreport:go .
# Stage 1: Build client SPA
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Build one static binary with the SPA and PWA files embedded
FROM golang:1.26-bookworm AS go-builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ cmd/
COPY internal/ internal/
COPY scripts/go_assets.sh scripts/go_assets.sh
COPY backend/app/static/ backend/app/static/
COPY --from=frontend-builder /app/backend/app/static/app/ backend/app/static/app/

RUN bash scripts/go_assets.sh \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/legkyi ./cmd/server

# Stage 3: Minimal production runtime
FROM debian:bookworm-slim AS runtime

WORKDIR /app

# curl for the health check, CA certificates for cloudflared
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# cloudflared is started and supervised by the app itself (Адміністрування → Система)
COPY --from=cloudflare/cloudflared:latest /usr/local/bin/cloudflared /usr/local/bin/cloudflared

COPY --from=go-builder /out/legkyi /app/legkyi

# Persistent storage directories with permissive defaults for Windows bind mounts
RUN mkdir -p /app/data /app/backups && chmod 777 /app/data /app/backups

VOLUME ["/app/data", "/app/backups"]

ENV LEGKYI_DATA_DIR=/app/data \
    LEGKYI_BACKUPS_DIR=/app/backups \
    HOST=0.0.0.0 \
    PORT=8000

EXPOSE 8000

# Liveness: the process answers and the database is reachable
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:8000/healthz" || exit 1

# Single entry point: schema, backups, tunnel and the web server
CMD ["/app/legkyi"]
