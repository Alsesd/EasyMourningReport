#!/bin/sh

DATA_DIR="/app/data/tunnel"
mkdir -p "$DATA_DIR"
STATUS_FILE="$DATA_DIR/status.json"
SIDECAR_FILE="$DATA_DIR/.sidecar"
STOP_FILE="$DATA_DIR/.stop"
TOKEN_FILE="$DATA_DIR/token"
START_FILE="$DATA_DIR/.start"

touch "$SIDECAR_FILE"

CF_PID=""

stop_cf() {
    if [ -n "$CF_PID" ] && kill -0 "$CF_PID" 2>/dev/null; then
        echo "Stopping cloudflared (PID $CF_PID)..."
        kill -TERM "$CF_PID" 2>/dev/null || true
        wait "$CF_PID" 2>/dev/null || true
    fi
    CF_PID=""
}

cleanup() {
    echo "Shutting down tunnel sidecar..."
    stop_cf
    rm -f "$SIDECAR_FILE" "$START_FILE"
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "{\"state\": \"stopped\", \"public_url\": \"\", \"login_url\": \"\", \"error\": \"\", \"updated_at\": \"$NOW\"}" > "$STATUS_FILE"
    exit 0
}

trap cleanup INT TERM

if [ "$TUNNEL_ENABLED" = "false" ] || [ "$TUNNEL_ENABLED" = "0" ]; then
    echo "Tunnel is disabled via TUNNEL_ENABLED=false."
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "{\"state\": \"disabled\", \"public_url\": \"\", \"login_url\": \"\", \"error\": \"\", \"updated_at\": \"$NOW\"}" > "$STATUS_FILE"
    exec sleep infinity
fi

# Initial enabled state in Docker Compose
touch /app/data/.tunnel-enabled 2>/dev/null || true
touch /app/data/.tailscale-funnel-enabled 2>/dev/null || true
rm -f "$STOP_FILE"

TARGET_URL="${TUNNEL_TARGET_URL:-http://127.0.0.1:8000}"
LOG_FILE="/tmp/cloudflared.log"

start_tunnel_process() {
    stop_cf
    rm -f "$LOG_FILE"

    TOKEN=""
    if [ -f "$TOKEN_FILE" ]; then
        TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null | tr -d '\r\n')
    fi
    if [ -z "$TOKEN" ]; then
        TOKEN="${TUNNEL_TOKEN:-$CLOUDFLARE_TUNNEL_TOKEN}"
    fi

    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "{\"state\": \"starting\", \"public_url\": \"\", \"login_url\": \"\", \"error\": \"\", \"updated_at\": \"$NOW\"}" > "$STATUS_FILE"

    if [ -n "$TOKEN" ]; then
        echo "Starting Cloudflare Tunnel with token..."
        cloudflared tunnel --no-autoupdate run --token "$TOKEN" > "$LOG_FILE" 2>&1 &
        CF_PID=$!
        PUB_URL="${PUBLIC_URL:-}"
        NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        echo "{\"state\": \"running\", \"public_url\": \"$PUB_URL\", \"login_url\": \"\", \"error\": \"\", \"updated_at\": \"$NOW\"}" > "$STATUS_FILE"
    else
        echo "Starting TryCloudflare Quick Tunnel to $TARGET_URL..."
        cloudflared tunnel --no-autoupdate --url "$TARGET_URL" > "$LOG_FILE" 2>&1 &
        CF_PID=$!

        URL=""
        for i in $(seq 1 20); do
            if ! kill -0 "$CF_PID" 2>/dev/null; then
                break
            fi
            URL=$(grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" "$LOG_FILE" | head -n 1 || true)
            if [ -n "$URL" ]; then
                break
            fi
            sleep 1
        done

        if [ -n "$URL" ]; then
            echo "============================================================"
            echo "  Quick Tunnel URL: $URL"
            echo "============================================================"
            NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            echo "{\"state\": \"running\", \"public_url\": \"$URL\", \"login_url\": \"\", \"error\": \"\", \"updated_at\": \"$NOW\"}" > "$STATUS_FILE"
        else
            NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            ERR_MSG="Quick tunnel connection failed. Check internet connectivity or configure TUNNEL_TOKEN in .env for a dedicated tunnel."
            echo "{\"state\": \"error\", \"public_url\": \"\", \"login_url\": \"\", \"error\": \"$ERR_MSG\", \"updated_at\": \"$NOW\"}" > "$STATUS_FILE"
            stop_cf
        fi
    fi
}

start_tunnel_process

# Supervisor loop
while true; do
    touch "$SIDECAR_FILE"

    # Check if UI requested stop
    if [ -f "$STOP_FILE" ]; then
        if [ -n "$CF_PID" ]; then
            stop_cf
            NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            echo "{\"state\": \"stopped\", \"public_url\": \"\", \"login_url\": \"\", \"error\": \"\", \"updated_at\": \"$NOW\"}" > "$STATUS_FILE"
        fi
        sleep 1
        continue
    fi

    # Check if UI requested start
    if [ -f "$START_FILE" ]; then
        rm -f "$START_FILE"
        start_tunnel_process
        continue
    fi

    # If cloudflared exited unexpectedly while we should be running
    if [ -z "$CF_PID" ] || ! kill -0 "$CF_PID" 2>/dev/null; then
        CF_PID=""
        if [ ! -f "$STOP_FILE" ]; then
            echo "Cloudflared not running, retrying in 15 seconds..."
            sleep 15
            if [ ! -f "$STOP_FILE" ]; then
                start_tunnel_process
            fi
        fi
    fi

    sleep 2
done
