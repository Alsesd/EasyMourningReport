---
name: api-contract-change
description: Checklist for changing a backend route or response shape in EasyMourningReport and keeping the React client, API types, fixtures, and docs in sync. Use whenever editing internal/web/*.go handlers or frontend/src/platform/api/**.
---

1. Change the handler in `internal/web/` (and the rule or query in `internal/platform`, `internal/reports` or the owning package). New endpoints must go through the permission check in `internal/web/router.go`; organisation-scope data must be filtered by the principal's organisation id.
2. Update tests next to the code (`internal/web/*_test.go`). If the response shape of a covered endpoint changes, update the scenario in `testdata/contracts/*.json` deliberately and say why.
3. Update `frontend/src/platform/api/schema.d.ts` by hand (it is no longer generated) and the aliases in `src/platform/api/types.ts`.
4. Update the owning `api.ts` (module or `platform/access/api.ts`) and every frontend test fixture that builds that shape (`grep -rn "<field_name>" frontend/src`). Fixture drift is the most common breakage here.
5. Update `docs/API.md` (and `docs/modules/*.md` if behaviour changed). New UI strings go in `i18n.ts`, in Ukrainian.
6. Run the `verify` skill.
