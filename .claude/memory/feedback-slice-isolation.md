---
name: feedback-slice-isolation
description: User directive - feature slices (modules) stay separate and talk to the core only; track interference and fix it immediately
type: feedback
---

Feature slices (Go: `internal/reports`, `internal/transport`, future modules; frontend: `src/modules/*`) must be
separated from each other and interact with the rest of the program **only through `core`** (Go) or `platform/` + `ui/`
(frontend). When interference between slices is noticed, fix it in the same task, do not just report it.

**Why:** the user is growing the product module by module (reports, transport, notifications...) and wants any module
removable/addable without touching others. Stated 2026-11-06 when asking for this memory.

**How to apply:**
- Before finishing any task that touches a module or the shell, run `go test ./internal/registry/` (Go import rules,
  `boundaries_test.go`) and `npx vitest run src/boundaries.test.ts` (frontend rules). Both are in the normal gates.
- New shell->module needs go through a `core.Module` hook (examples: `Seed`+`SeedTools`, `DailyReminder`+`Notifier`),
  never by importing the module from `platform`/`web`/`store`.
- A module needing a platform service gets it as an interface in `core` (like `core.Notifier`, `core.SeedTools`).
- Shared pure helpers used by several slices live in `core` (e.g. `core.NormName`, `core.CleanName`).
- Record every leak found and its fix in `project-slice-boundaries.md`.
