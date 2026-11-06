# Security notes

Last reviewed: 2026-11-06 (dependency scans, code review of the web layer, live checks of the built binaries).

## Dependencies

- Go: built with the patched toolchain pinned in `go.mod` (`toolchain go1.26.10`); `govulncheck` on the source finds nothing the code calls. Re-run `govulncheck ./cmd/... ./internal/...` and `govulncheck -mode binary dist/legkyi.exe` before each release.
- Known false positive: binary mode lists GO-2026-5932 (`x/crypto/openpgp`). The program links only `x/crypto/md4` and `ripemd160` (through the Excel library) and no `openpgp` package, so it is not affected. No tagged fix exists yet.
- Frontend: `npm audit` reports 0 vulnerabilities (react-router 7.18+, vitest 5, a `minimatch` override in `package.json` for the linter chain). Do not run `npm audit fix --force`.

## What is in place

- **Sessions:** HMAC-SHA256 signed cookie, constant-time compare, expiry inside the signed payload, `HttpOnly`, `SameSite=Lax`; `Secure` is set when `COOKIE_SECURE=1` or when the request reached the local cloudflared over https (`X-Forwarded-Proto` or `Cf-Visitor`).
- **CSRF:** every non-GET request must carry a same-origin `Origin` or `Referer`.
- **Sign-in:** per login+IP, per IP and per login limits (in memory); the password is checked before account state is revealed; an unknown login costs the same time as a wrong password.
- **Client address:** the forwarded header is honoured only from the local cloudflared, and the right-most untrusted hop is used, so a client cannot spoof it behind Cloudflare.
- **Passwords:** PBKDF2-HMAC-SHA256, 200,000 iterations, random salt.
- **Headers:** a Content-Security-Policy (scripts only from the app's own files, no framing), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **Limits:** JSON bodies 8 MB, Excel upload capped, read/idle/header limits on the server (no write timeout so backup downloads can stream).
- **Data access:** every API route goes through a permission check; organisation-scoped handlers resolve records through the caller's organisation (other organisations' records answer 404). SQL is parameterised; the only concatenated clauses are fixed strings.
- **Tunnel token:** passed to cloudflared through its environment (not the command line) and stored with mode 0600.
- **Release workflow:** the tag input goes through an environment variable and is validated.

## Known limitations

- Sessions are stateless: logging out or changing a password does not invalidate cookies already issued (they expire after 7 days). Rotating `secret.key` signs everyone out.
- PBKDF2 at 200,000 iterations is below current OWASP guidance (600,000 for SHA-256). Raising it needs a format marker and upgrade-on-login so existing hashes keep working.
- The sign-in limiter is in memory and resets on restart.
- The exe is not code-signed (SmartScreen warning). Anyone who can read the program's folder can read `reports.db`, `secret.key` and the saved tunnel token; protect that folder with normal file permissions.
- `style-src` allows inline styles because the UI sets style attributes.
