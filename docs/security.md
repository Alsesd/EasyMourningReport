# Security notes

Last reviewed: 2026-11-06 (dependency scans, code review of the web layer, live checks of the built binaries).

## Dependencies

- Go: built with the patched toolchain pinned in `go.mod` (`toolchain go1.26.10`); `govulncheck` on the source finds nothing the code calls. Re-run `govulncheck ./cmd/... ./internal/...` and `govulncheck -mode binary dist/legkyi.exe` before each release.
- Known false positive: binary mode lists GO-2026-5932 (`x/crypto/openpgp`). The program links only `x/crypto/md4` and `ripemd160` (through the Excel library) and no `openpgp` package, so it is not affected. No tagged fix exists yet.
- Frontend: `npm audit` reports 0 vulnerabilities (react-router 7.18+, vitest 5, a `minimatch` override in `package.json` for the linter chain). Do not run `npm audit fix --force`.

## What is in place

- **Sessions (server-side):** the cookie carries a random 32-byte token signed with HMAC-SHA256; the server keeps only the SHA-256 of the token in `user_sessions` (so a database copy or backup holds no usable credential). Logging out, changing your own password, an administrator resetting a password, and disabling or deleting an account end the sessions immediately; sessions survive an app restart and expire after 7 days. Cookie flags: `HttpOnly`, `SameSite=Lax`, and `Secure` when `COOKIE_SECURE=1` or when the request reached the local cloudflared over https.
- **Device-bound sessions (rolling device token):** every session is tied to the browser it was issued to by a second cookie (`device`, `HttpOnly`, signed) whose token is stored only as a SHA-256 in `session_devices`. The token is replaced every 10 minutes of use (the previous one stays valid for 30 minutes so parallel requests and a lost response do not sign anyone out). A request whose session cookie is not signed by this server, or whose device token does not match, gets **no answer at all** (the connection is closed without a byte) and a mismatched session is revoked on the spot, so a copied cookie is useless and a probe learns nothing. Sessions created before this existed are invalid after the upgrade (users sign in once).
- **Passkeys (biometric sign-in, WebAuthn):** users register the fingerprint, face or screen lock of a device in the account menu and sign in with one tap. Only discoverable credentials with user verification are accepted (ES256 or RS256, no attestation); the server stores the public key and a signature counter and rejects a counter that does not advance (cloned authenticator). Challenges are single-use and expire in 5 minutes; failures are rate limited per IP and audited. Passkeys need https (the tunnel provides it) and are bound to the host name: with a quick tunnel (`trycloudflare.com`, new name on each start) they stop working when the name changes, so use a named tunnel (`TUNNEL_TOKEN`) or pin `PASSKEY_RP_ID`.
- **CSRF:** every non-GET request must carry a same-origin `Origin` or `Referer`.
- **Sign-in:** per login+IP, per IP and per login limits (in memory); the password is checked before account state is revealed; an unknown login costs the same time as a wrong password (a short window remains for accounts whose password has not yet been upgraded, see below).
- **Client address:** the forwarded header is honoured only from the local cloudflared, and the right-most untrusted hop is used, so a client cannot spoof it behind Cloudflare.
- **Passwords:** PBKDF2-HMAC-SHA256, 600,000 iterations, random salt, self-describing format (`pbkdf2_sha256$600000$salt$hash`). Hashes from earlier releases (200,000 iterations) still verify and are rewritten when that user next signs in successfully. New passwords need at least 10 characters. Expect roughly a second per sign-in on a phone.
- **Headers:** Content-Security-Policy (scripts only from the app's own files, no framing), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` (180 days, no subdomains, no preload) on requests that arrived over https through the tunnel.
- **Limits:** JSON bodies 8 MB, Excel upload capped, read/idle/header limits on the server (no write timeout so backup downloads can stream).
- **Data access:** every API route goes through a permission check; organisation-scoped handlers resolve records through the caller's organisation (other organisations' records answer 404). SQL is parameterised; the only concatenated clauses are fixed strings.
- **Files:** on Linux/macOS/Android the program runs with umask 077 and tightens the database, WAL files, secret, backups and tunnel folder to owner-only at start. On Windows access is governed by NTFS permissions: keep the program's folder in a location only the service account and administrators can read (for example remove "Users" from its ACL).
- **Tunnel token:** passed to cloudflared through its environment (not the command line) and stored with mode 0600.
- **Release workflow:** the tag input goes through an environment variable and is validated; the exe can be signed when the repository has the secrets `WINDOWS_CERT_PFX` and `WINDOWS_CERT_PASSWORD` (this step has not been exercised yet).

## Rolling back to the Python release

Accounts whose password hash was upgraded cannot sign in to the Python release (it only knows the old format), and the `user_sessions` table is ignored by it. A rollback therefore means restoring the backup taken before switching to Go.

## Known limitations

- The sign-in limiter is in memory and resets when the app restarts; only someone with host access can restart it, and they already hold the database.
- Until every account has signed in once after the upgrade, a sign-in for an account on an old hash takes less time than one on the new hash, and an unknown login takes the new-hash time.
- The exe is unsigned unless you add a certificate (SmartScreen warning). Anyone who can read the program's folder can read `reports.db`, `secret.key` and the saved tunnel token.
- `style-src` allows inline styles because the UI sets style attributes; scripts are strictly limited to the app's own files.
- No password complexity rules beyond length. A passkey is a second way in, not a second factor: an account with a password can still sign in with the password alone.
