# Slice isolation

Feature modules (Go `internal/reports`, `internal/transport`, ...; frontend `src/modules/*`) are separate slices.
They talk to the rest of the program **only through `core`** (Go) or `platform/` + `ui/` (frontend), never to each other.

- Before finishing work that touches a module or the shell, run `go test ./internal/registry/` and
  `cd frontend && npx vitest run src/boundaries.test.ts`; both fail on a new cross-slice import.
- If the shell needs something from a module, add a hook to `core.Module` (see `Seed`/`SeedTools`,
  `DailyReminder`/`Notifier`); if a module needs a platform service, add an interface in `core`. Shared pure helpers
  go in `core` too. Never import a module from `platform`, `store` or `web` (known debt: the handlers in
  `internal/web/reports*.go` and `transport.go`; the test freezes that list - nothing new may join it).
- When you notice interference between slices, fix it in the same task and note it in the project memory.
