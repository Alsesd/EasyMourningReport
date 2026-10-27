# Reports module

**Location:** `frontend/src/modules/reports/`

## Responsibilities

Monthly store-report entry, admin summaries, report list/detail/status, audit-log views, and catalogue/store management currently live in this module. The module owns its API wrapper (`api.ts`), Ukrainian UI dictionary and formatting helpers (`i18n.ts`), lazy page registry (`module.tsx`), pages, and page tests.

## Boundaries

- Use `platform/api/client.ts` for HTTP mechanics, session cookies, and structured API errors.
- Use `platform/api/types.ts` for generated DTO types.
- Keep route registration in the app shell while page-level code splitting and feature page ownership remain in `module.tsx`.
- Keep tunnel endpoint calls in `modules/transport/api.ts`; settings may expose those controls, but shouldn't duplicate tunnel endpoint paths.

## Tests

```bash
cd frontend
npm test -- --run src/modules/reports
```
