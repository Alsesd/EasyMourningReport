---
name: project-frontend-structure
description: Frontend layout (frontend/src) - app shell, platform, ui primitives, modules - and UI conventions
type: project
---

`frontend/src`: `app/` (App, layouts, routing, registry - the shell), `platform/` (api client+types, auth, i18n, admin hub,
access, system, account, notifications, modules registry), `ui/` (primitives: Button, Dialog, Switch, DayPicker,
TimeField, LedgerSection, PageHeader...), `modules/<name>/` (reports, transport: `module.tsx` with routes/nav/admin
sections, `api.ts`, `i18n.ts`, `permissions.ts`, pages, components). Modules are listed in `modules/index.ts`.
Data via react-query; sections poll (`refetchInterval`) instead of full reloads (backups 15 s, bell 20 s, transport 15 s).
Conventions: Ukrainian strings in `i18n.ts`; figures use `.figure`; no native month/file controls; 44px touch targets;
Tailwind colours via CSS-variable tokens; `schema.d.ts` edited by hand with every API change. Layouts: `AdminLayout`
(sidebar+mobile bar+bell) and a standalone layout for the store report page (also has the bell).
