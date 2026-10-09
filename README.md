# Sales reports (prototype)

Double-click `start.bat` (installs dependencies, then starts the server on port 8000).
Manual start from this folder: `poetry install`, then `poetry run uvicorn app.main:app --host 0.0.0.0`.

Backups: reports.db is copied to backups/ on start, on stop, hourly (only if changed) and before any delete.
Keeps the newest 100 files (env BACKUP_KEEP, BACKUP_EVERY_MIN). To restore: stop the server, copy a backup over reports.db.
Open http://localhost:8000. On first run an admin password is generated and printed in the console
(or set ADMIN_PASSWORD; set DEMO=1 to also seed demo products and stores store1/store1, store2/store2).
Session secret is generated into secret.key (or set SECRET_KEY). DB file: reports.db (SQLite).

Flow: admin edits products/prices and creates stores+logins -> stores open /report, enter quantities
only (sums are computed on the server) -> admin opens Summary for the month, or downloads CSV.
Not in the prototype: CSRF protection, password change, Alembic migrations.

NixOS: `nix-shell` then `serve` (nixpkgs packages, no Poetry). It runs `tailscale funnel --bg 8000` and serves on 127.0.0.1 only.
One-time setup: `services.tailscale.enable = true;`, then `sudo tailscale up` and `sudo tailscale set --operator=$USER`.

Login throttling: 5 failed attempts per IP+login, 20 per IP, 30 per login within 15 minutes (resets on restart).
Install as an app: open the HTTPS address on the phone. Android/Chrome: Install app button on the login page or browser menu. iPhone: Share, Add to Home Screen.

## HTTPS with a trusted certificate (free, no domain): Tailscale Funnel
1. Install Tailscale on the Windows PC and log in.
2. Tailscale admin console > DNS: enable MagicDNS and HTTPS certificates.
3. Run `start.bat`. It runs `tailscale funnel --bg 8000` (kept across restarts) and starts the app on 127.0.0.1 only,
   so the only way in is HTTPS. The first time, Tailscale prints a link to allow Funnel for this machine; open it, approve, run `start.bat` again.
4. The public address `https://<pc-name>.<tailnet>.ts.net` is shown by `tailscale funnel status`.
Stop publishing: `tailscale funnel reset`. The PC must stay on. Funnel traffic has Tailscale's bandwidth limits (plenty for this app).
