---
name: project-slice-boundaries
description: Current slice dependency rules, enforcement tests, fixed leaks and the one known remaining debt (web handlers import modules)
type: project
---

**Allowed Go imports (enforced by `internal/registry/boundaries_test.go`):**
core -> nothing internal; store -> nothing; platform -> core, store; system -> store; reports, transport -> core only;
web -> core, platform, registry, store, system, update (+ reports/transport = known debt); registry and `cmd/server`
are the only wiring points that list modules.
**Frontend (enforced by `frontend/src/boundaries.test.ts`):** `platform/` and `ui/` never import `modules/` or `app/`;
a module imports neither another module nor `app/`.

**Leaks found and fixed (2026-11-06):**
1. `web/notifications.go` imported `transport` for the 14:30 reminder -> now `core.Module.DailyReminder` +
   `core.Notifier`; reminder code lives in `internal/transport/reminder.go`; web only loops over modules.
2. `reports/seed.go` imported `platform` (demo users) -> `core.SeedTools.CreateUser`, `core.SeedFunc`.
3. `reports/xlsx_import.go` imported `platform` (name helpers) -> `core.NormName` / `core.CleanName`
   (platform's versions delegate to core).

**KNOWN DEBT (not fixed, needs a larger refactor):** the HTTP handlers of reports and transport live in `internal/web`
(`reports.go`, `reports_xlsx.go`, `transport.go`) and so import the module packages; they also use web internals
(`a.write`, `Body`, `Query`, `a.authed`). The boundary test freezes this list - nothing new may join it.
**Plan to remove it:** expose a small `core.HTTP` surface (router registration, authed wrapper, write-tx runner, body/query
parsing, error types) so a module registers its own routes in `Module.Routes`; move the three files into the module
packages; then drop the exception from `TestWebDoesNotGrowNewModuleImports`.
Also: `notifyHolders` calls in `web/transport.go` and `web/reports.go` use the modules' permission codes (fine until the move).
