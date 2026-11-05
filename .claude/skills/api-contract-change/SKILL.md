---
name: api-contract-change
description: Checklist for changing a backend DTO, route, or response shape in EasyMourningReport and keeping the React client, generated types, fixtures, and docs in sync. Use whenever editing schemas.py or routes.py under backend/app/platform or backend/app/modules, or frontend/src/platform/api/**.
---

1. Change the DTO in the owning `schemas.py` (platform feature or module) and its route. New endpoints need `Depends(require(...))`; organisation-scope data must be filtered by `principal.organisation_id`. Never import another module.
2. Update tests next to the code: `backend/app/tests/` for platform, `backend/app/modules/<name>/tests/` for modules. Use `app.platform.accounts.testing` helpers to create accounts.
3. Regenerate client types: `cd frontend && npm run gen:api`. Update aliases in `src/platform/api/types.ts`.
4. Update the owning `api.ts` (module or `platform/access/api.ts`) and every frontend test fixture that builds that DTO (`grep -rn "<field_name>" frontend/src`). Fixture drift is the most common breakage here.
5. Update `docs/API.md` (and `docs/modules/*.md` if behaviour changed). New UI strings go in `i18n.ts`, in Ukrainian.
6. Run the `verify` skill.
