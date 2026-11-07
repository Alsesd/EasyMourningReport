---
name: project-architecture
description: Structure and core principles of EasyMourningReport (Go + embedded React SPA): packages, data, access, schema rules
type: project
---

Internal platform of a burial-service business ("Легкий звіт"). One Go binary (stdlib net/http, SQLite via modernc) serves
`/api/v1` and an embedded React 18 + Vite + Tailwind SPA; UI is Ukrainian, user chats in Russian. Backend was ported from
Python (last Python release commit 92564ef). Authoritative docs: `CLAUDE.md`, `docs/architecture.md`, `docs/modules/*.md`.

**Packages (`internal/`)**: `core` (contracts: Module, Notifier, SeedTools, text helpers), `store` (open, schema,
backups), `platform` (users, roles, permissions, principal, bootstrap, audit, notifications), `reports`, `transport`
(feature slices), `registry` (installed modules), `web` (router, sessions, CSRF, handlers, scheduler), `system`
(tunnel, health), `update` (self-update), `config`, `assets`, `tunnelbin`. `cmd/server` wires; `cmd/smoke` is the
binary smoke test.

**Principles**
- Access: every route via `a.authed(codes, h)` / `a.member(codes, h)`; org-scope permissions only touch the caller's org.
- Writes: single writer, all mutations in `a.write(ctx, func(tx))`, use only that tx inside. Notifications and audit rows
  are written in the SAME tx as the event.
- Money in integer cents; periods `YYYY-MM`; never touch `data/`, `backups/`, `reports.db`, `secret.key`, `.env`.
- Schema: `fresh.sql` mirrors Python; Go-owned tables live in `goOwned` in `store/schema.go` (+ `GoOwnedTables`, test
  `structure()` filter); columns added later via `goOwnedColumns` (idempotent ALTER). Production data exists.
- Frozen fixtures in `testdata/` change only on purpose, with the reason in the commit.
- Verify gate (no CI): `go vet`+`go test ./cmd/... ./internal/...` (never `./...`), frontend lint/typecheck/test/build,
  and for UI work `scripts/build_go.sh` + `go run ./cmd/smoke -exe dist/legkyi -tunnel` + `scripts/e2e_test.py`.
- Work style: commit + push each finished feature on branch `claude/go-migration-umm1ck` (stop hook insists), run the
  `verify` skill first; update `docs/API.md`, `schema.d.ts` (hand-maintained), module docs with every API change.
