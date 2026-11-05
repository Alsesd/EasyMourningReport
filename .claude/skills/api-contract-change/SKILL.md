---
name: api-contract-change
description: Checklist for changing a backend DTO, route, or response shape in EasyMourningReport and keeping the React client, generated types, fixtures, and docs in sync. Use whenever editing backend/app/dto.py, backend/app/routes/**, or frontend/src/platform/api/**.
---

1. Change the DTO in `backend/app/dto.py` and the route/service. Keep business logic in `services/`, persistence in `db/repositories/`. Import from owning modules, not package facades.
2. Update backend tests in `backend/app/tests/` (usually `test_api_v1.py`).
3. Regenerate client types: `cd frontend && npm run gen:api`. Update aliases in `src/platform/api/types.ts`.
4. Update the module `api.ts` and every frontend test fixture that builds that DTO (`grep -rn "<field_name>" frontend/src`). Fixture drift is the most common breakage here.
5. Update `docs/API.md` (and `docs/modules/*.md` if behaviour changed). New UI strings go in `i18n.ts`, in Ukrainian.
6. Run the `verify` skill.
