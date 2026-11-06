---
name: project-slice-boundaries
description: Slice dependency rules, how a module exposes its HTTP routes through core, enforcing tests, history of fixed leaks (no open debt)
type: project
---

**Allowed Go imports (enforced by `internal/registry/boundaries_test.go`):**
core -> nothing internal; store -> nothing; platform -> core, store; system -> store; reports, transport -> core only;
web -> core, platform, registry, store, system, update (NO module); registry and `cmd/server` are the only wiring
points that list modules. **Frontend (`frontend/src/boundaries.test.ts`):** `platform/` and `ui/` never import
`modules/` or `app/`; a module imports neither another module nor `app/`.

**HTTP of a module (done 2026-11-06, no open debt):** handlers live in `internal/<module>/http*.go`, listed in
`core.Module.Routes(core.Services) []core.Route` (`Method, Path, Codes, Member, Handler`). The shell
(`internal/web/modules.go`) builds `core.Services` (Read, Write tx, Now, ClientIP, Audit, Notify, NotifyHolders,
Snapshot, Organisation) and `core.Caller` from its `platform.Principal`, and registers each route behind
`a.authed`/`a.member`. Request parsing (`core.Body`, `core.Query`, `core.Param`) and errors (`core.HTTPError`,
`FormError`, `ValidationError`) live in `core/validation.go`; `web/validation.go` keeps aliases + `fail`.
`TestModuleRoutesRequireSignIn` checks every module route answers 401 anonymously. Need more from the shell for a
module -> add a field to `core.Services`, never import.
Gotcha when moving code: notification kinds are strings like `"transport.new"` (a blanket `transport.` strip broke
them once; the notification tests caught it).

**Leaks found and fixed earlier (2026-11-06):** web importing transport for the 14:30 reminder (now
`Module.DailyReminder` + `core.Notifier`); `reports/seed.go` importing platform (now `core.SeedTools`);
`reports/xlsx_import.go` importing platform name helpers (now `core.NormName`/`CleanName`).
