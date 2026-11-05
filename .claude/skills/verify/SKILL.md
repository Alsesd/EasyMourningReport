---
name: verify
description: Run the full EasyMourningReport verification gate (backend pytest, frontend lint, typecheck, vitest, build). Use before committing, after any backend or frontend change, or when asked to "check everything".
---

This repo has no CI, so this is the gate. Run from the repository root:

1. `uv run --locked pytest -q`
2. `cd frontend && npm run lint && npm run typecheck && npm test && npm run build`

Run step 2's build before re-running pytest if `backend/app/static/app/` is missing, because `test_spa_fallback_serves_html` needs it.

If only one side changed you may skip the other, but say so. Report failures with the test name and assertion. Never skip, delete, or weaken a test to get green.
