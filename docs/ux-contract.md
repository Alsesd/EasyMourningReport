# UX Contract

## Product context

- **Audience:** Ukrainian-speaking staff and administrators of a burial agency.
- **Primary jobs:** Enter monthly report quantities per division; save drafts or submit a read-only report; review all divisions' reports; place and dispatch transport orders; read the management figures; manage products, prices, accounts, roles, backups, updates and audit logs. The interface calls an organisation «підрозділ» (division).
- **Active locale:** Ukrainian (`uk-UA`). Shared interface copy and number/date helpers live in `frontend/src/platform/i18n.ts`; each module extends it in its own `i18n.ts`.
- **Accessibility target:** WCAG 2.2 AA as the working target, with 44px minimum touch targets where practical, visible keyboard focus, named icon-only controls, and reduced-motion support.

## Business-context sources

| Domain | Source | Authority |
|---|---|---|
| API access and error contracts | [`API.md`](API.md) | API contract |
| Route map and behavior owners | [`ui-parity.md`](ui-parity.md) | Implementation map |
| Product-specific report and price rules | [`DESIGN.md`](DESIGN.md) | Maintained product UX notes |
| Permission enforcement | `internal/web/session.go`, `internal/platform/principal.go`, `frontend/src/app/routing/ProtectedRoute.tsx` | Runtime enforcement evidence |

## Visual contract

- **Design:** [`design-system.md`](design-system.md)
- **Token ownership:** Existing CSS custom properties remain canonical; Tailwind semantic colors and shared components consume them.
- **Runtime token source:** `frontend/src/app/index.css`, `frontend/tailwind.config.js`.
- **Themes:** Light, dark and system preference persisted by `ThemeContext`.

## Canonical UI map

| Capability | Canonical owner | Source of truth | Variants | Verification |
|---|---|---|---|---|
| Form controls | `frontend/src/ui/Input.tsx`, shared form markup | API DTOs + `i18n.ts` | create/edit | frontend tests + keyboard review |
| Buttons | `frontend/src/ui/Button.tsx` | UI primitives + design tokens | primary/secondary/destructive/ghost/outline | component/page tests |
| Dialogs | `frontend/src/ui/Dialog.tsx` | action-specific confirmation copy | confirm/cancel | keyboard + action tests |
| Navigation | `frontend/src/app/layouts/AdminLayout.tsx` | route map in `App.tsx` | desktop rail/mobile bottom bar | route + narrow viewport review |
| Date/period | `frontend/src/ui/PeriodPicker.tsx` (Ukrainian month list with previous/next) + period helpers | `YYYY-MM`, report API | month selector | period tests |
| On/off settings | `frontend/src/ui/Switch.tsx` (native checkbox, `role="switch"`, state text follows state) | API DTOs | per-row toggles | page tests |
| Scrollbar | global stylesheet | `design-system.md` | standard; native overflow for data tables | computed CSS + keyboard scroll |
| CRUD and persistence | report module API + TanStack Query mutations | `docs/API.md` | draft, submit, archive/restore, lock/unlock | API and page tests |

## Navigation and responsive behavior

- Workspace destinations come from the module registry and the user's permissions (e.g. Звіт підрозділу, Звіти, Транспорт, Показники, Адміністрування). Desktop uses a persistent sidebar with the account menu at its foot; mobile uses a fixed bottom navigation with safe-area padding and matching `aria-current` state, and the account menu in the header.
- «Адміністрування» is one hub: an overview, then sections grouped as Доступ, Довідники модулів, Система, Активність. Modules add their own sections. One shared status message at the top of the section reports success or errors.
- Hub navigation lives in ONE place per screen size: on desktop the sections are nested under «Адміністрування» in the side rail (no second menu column, so forms and tables get the width); on phones a single sticky picker names the current section and opens the grouped list (no horizontally scrolling tab row, where sections hide off-screen).
- Creating an organisation never forces an employee: employees are an optional list (new accounts with login, password, role and a password generator, or existing accounts moved in) that can also be done later in «Користувачі».
- The maker mark («A.» reveals «made by Alsesd») stays in the workspace rail or top bar, on the store report and on the login page, on every screen size.
- The report detail route remains nested under Reports and has a clear return path to its parent list.
- Report-period state belongs in the URL where existing pages already use query parameters; switching periods must preserve related filters.
- Tables preserve comparison relationships; on narrow screens use horizontal overflow with a pinned first column, or ruled rows whose detail opens on demand. Never silently discard a column's data or actions on mobile.
- Long forms use document scrolling. Fixed navigation must not obscure focused controls or the virtual keyboard.
- Each route sets a localized document title (`Page — Product`); titles never contain passwords, secrets or other sensitive values.

## Workflow invariants

- **Store draft:** edits are persisted locally; save sends the draft to the store-report API; success feedback appears without changing the report's role or period context; failure preserves quantities for retry.
- **Submit report:** ask for confirmation; pending state blocks duplicate submit; success sets the report read-only and confirms submission; failure leaves the form recoverable.
- **Admin lock/unlock:** require the existing confirmation dialog; successful changes refresh the report state; errors remain visible and retryable.
- **Product/store CRUD:** retain current create/edit/archive/restore semantics and server validation. Archived entities with history must not be treated as irreversibly deletable.
- **Price timeline:** price history is append-only through the API; report quantities are associated with product and unit price. No-op saves must not be presented as changes.
- **Search/filter:** keep the current query/filter context where implemented; loading or error states must not silently erase user-entered criteria.

## Async and resilience

- Keep TanStack Query as the server-state owner; do not duplicate API state in a new screen-local cache.
- Preserve the current same-origin signed-cookie authentication and structured API error mapping.
- Retry is explicit for failed fetches; don't show infinite loaders. Keep form/report input after recoverable save errors.
- Store report drafts remain locally persisted for offline recovery. UI should distinguish offline/unsynced work from a saved server state.
- Submitted reports are read-only. Authorization is enforced by the server and route protection; hiding a control is not a substitute for authorization.

## Overlays and feedback

- Use the shared Radix-backed `Dialog` component for consequential actions; no browser-native `alert`, `confirm` or `prompt`.
- Loading, success, error, empty and no-results states should be clear and use the existing live-region/status patterns.
- Destructive actions remain separate from ordinary primary actions and use specific labels.

## Verification

- Required frontend commands from `frontend/`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Review desktop and narrow phone layouts, both theme modes, keyboard focus, reduced motion and long labels.
- API and workflow source: `docs/API.md`, `docs/ui-parity.md`, `frontend/src/modules/reports/pages/*.test.tsx`.
