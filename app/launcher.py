"""Launcher shared by source and packaged entry points."""

import os
import socket
import sys
import threading
import time
import webbrowser

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uvicorn

from app.main import app
from app.core.tailscale import start_if_enabled as start_tailscale_if_enabled


def _bind_available_socket(
    host: str,
    preferred_port: int,
    *,
    allow_fallback: bool,
    attempts: int = 100,
) -> tuple[socket.socket, int]:
    """Bind a listener before starting Uvicorn, avoiding a port-selection race."""
    last_error: OSError | None = None
    candidate_end = min(65535, preferred_port + (attempts - 1 if allow_fallback else 0))

    for port in range(preferred_port, candidate_end + 1):
        try:
            addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise OSError(f"Cannot resolve server host {host!r}: {exc}") from exc

        for family, socktype, proto, _, address in addresses:
            listener = socket.socket(family, socktype, proto)
            try:
                listener.bind(address)
                listener.listen(socket.SOMAXCONN)
                listener.setblocking(False)
                return listener, port
            except OSError as exc:
                last_error = exc
                listener.close()

        if not allow_fallback:
            break

    if allow_fallback:
        tried = f"ports {preferred_port}-{candidate_end}"
    else:
        tried = f"port {preferred_port}"
    detail = f": {last_error}" if last_error else ""
    raise OSError(f"Could not bind the local server on {host} ({tried}){detail}") from last_error


def _open_browser_when_ready(server: uvicorn.Server, url: str) -> None:
    """Open the local UI only after Uvicorn has completed application startup."""
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if server.started:
            try:
                webbrowser.open(url, new=2)
            except Exception:
                pass
            return
        if server.should_exit:
            return
        time.sleep(0.2)


def server_start(
    host: str | None = None,
    port: int | None = None,
) -> None:
    """Start the local web server and select a fallback port when the default is busy."""
    resolved_host = host or os.getenv("HOST", "127.0.0.1")
    explicit_port = port is not None or "PORT" in os.environ
    raw_port = port if port is not None else os.getenv("PORT", "8000")
    try:
        preferred_port = int(raw_port)
        if not 1 <= preferred_port <= 65535:
            raise ValueError
    except (TypeError, ValueError):
        print("PORT must be an integer between 1 and 65535.", file=sys.stderr, flush=True)
        raise SystemExit(2)

    try:
        listener, actual_port = _bind_available_socket(
            resolved_host,
            preferred_port,
            allow_fallback=not explicit_port,
        )
    except OSError as exc:
        print(
            f"Unable to start the local server on {resolved_host}:{preferred_port}: {exc}",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(1) from exc

    # Keep the optional Funnel helper aimed at the actual listener when the
    # default port was occupied and an automatic fallback was selected.
    os.environ["PORT"] = str(actual_port)

    if actual_port != preferred_port:
        print(
            f"Port {preferred_port} is already in use; switched automatically to port {actual_port}.",
            flush=True,
        )

    browser_host = "127.0.0.1" if resolved_host in {"0.0.0.0", "::", ""} else resolved_host
    if ":" in browser_host and not browser_host.startswith("["):
        browser_host = f"[{browser_host}]"
    url = f"http://{browser_host}:{actual_port}"
    print(f"Local web app: {url}", flush=True)

    # Launch the opted-in Funnel helper before Uvicorn starts accepting app
    # requests. Its reverse proxy can come online first; it will return a clear
    # 502 only during the short interval before the local app becomes ready.
    try:
        funnel_status = start_tailscale_if_enabled()
        if funnel_status:
            state = funnel_status.get("state", "starting")
            if state == "error":
                print(
                    f"Tailscale Funnel did not start: {funnel_status.get('error', 'unknown error')}",
                    file=sys.stderr,
                    flush=True,
                )
            else:
                print(f"Tailscale Funnel startup requested (state: {state}).", flush=True)
    except Exception as exc:
        # A Funnel failure must not prevent the local app from starting.
        print(f"Tailscale Funnel startup failed: {exc}", file=sys.stderr, flush=True)

    server = uvicorn.Server(uvicorn.Config(app, host=resolved_host, port=actual_port))
    auto_open = os.getenv("LEGKYI_AUTO_OPEN_BROWSER", "1").strip().lower()
    running_in_actions = os.getenv("GITHUB_ACTIONS", "").strip().lower() == "true"
    if auto_open not in {"0", "false", "no"} and not running_in_actions:
        threading.Thread(
            target=_open_browser_when_ready,
            args=(server, url),
            name="open-local-web-app",
            daemon=True,
        ).start()

    try:
        server.run(sockets=[listener])
    finally:
        listener.close()
