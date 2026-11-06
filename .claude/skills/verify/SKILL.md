---
name: verify
description: Run the full EasyMourningReport verification gate (Go vet and tests, frontend lint, typecheck, vitest, build, browser smoke test). Use before committing, after any backend or frontend change, or when asked to "check everything".
---

This repo has no CI, so this is the gate. Run from the repository root:

1. `cd frontend && npm run lint && npm run typecheck && npm test && npm run build` (the build writes `internal/assets/static/app/`, which the Go binary embeds)
2. `go vet ./cmd/... ./internal/... && go test ./cmd/... ./internal/...` (use these package paths, not `./...`, which descends into `frontend/node_modules`)
3. After UI or navigation changes: `bash scripts/build_go.sh && go run ./cmd/smoke -exe dist/legkyi -tunnel && CHROMIUM_PATH=/opt/pw-browsers/chromium LEGKYI_E2E_BINARY=dist/legkyi uv run scripts/e2e_test.py`

If only one side changed you may skip the other, but say so. Report failures with the test name and assertion. Never skip, delete, or weaken a test to get green.
