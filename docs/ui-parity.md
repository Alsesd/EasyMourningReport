# UI Behavior and Implementation Map

This document records the current browser behavior and points to the code that owns it. Older server-rendered page templates and static page scripts have been removed; references to them are intentionally not used as current file paths. 

## Application shell and authentication

| Behavior | Current implementation |
|---|---|
| React router and route-level lazy loading | `frontend/src/app/App.tsx`, each module's `module.tsx` |
| Login form, validation feedback, and focus behavior | `frontend/src/app/pages/LoginPage.tsx` |
| Session loading, sign-in, and sign-out | `frontend/src/platform/auth/AuthContext.tsx` |
| Permission-based route protection and post-login landing | `frontend/src/app/routing/ProtectedRoute.tsx`, `frontend/src/app/routing/landing.ts` |
| Account menu (identity, own password, passkeys, sign-out) | `frontend/src/platform/account/AccountMenu.tsx`, `PasskeysForm.tsx`, `PasswordForm.tsx` |
| Biometric sign-in offer after the first password sign-in; passkey sign-in on the login page | `frontend/src/platform/account/BiometricOffer.tsx`, `frontend/src/platform/auth/passkeys.ts`, `biometricPref.ts`, `LoginPage.tsx` |
| First-sign-in device setup (notifications permission, install prompt) and Web Push registration | `frontend/src/platform/device/DeviceSetup.tsx`, `push.ts`, `installPrompt.ts`, `service worker internal/assets/static/sw.js` |
| Notification bell: anchored panel (bottom sheet on phones), list, device switch row, test notification | `frontend/src/platform/notifications/NotificationBell.tsx`, `frontend/src/ui/Popover.tsx` |
| Dialogs (centred modal / phone bottom sheet), confirmations, loading skeletons, empty states | `frontend/src/ui/Dialog.tsx`, `ConfirmDialog.tsx`, `Skeleton.tsx`, `EmptyState.tsx`, `.dialog-panel` in `frontend/src/app/index.css` |
| Interface scale and theme menu («Вигляд») | `frontend/src/platform/theme/ThemeContext.tsx`, `uiScale.ts` |
| Module registry (routes, nav, settings, landing) | `frontend/src/app/registry.ts`, `frontend/src/platform/modules.ts`, `frontend/src/modules/index.ts` |
| Same-origin request behavior and structured API errors | `frontend/src/platform/api/client.ts` |
| Theme selection and persistence | `frontend/src/platform/theme/ThemeContext.tsx`, `frontend/src/ui/ThemeToggle.tsx` |
| Shared responsive navigation and application layout | `frontend/src/app/layouts/AdminLayout.tsx` |

## Store report

| Behavior | Current implementation |
|---|---|
| Period selection, report load/save, dirty state, and submission | `frontend/src/modules/reports/pages/StoreReportPage.tsx` |
| Quantity stepper and read-only/report status cues | `frontend/src/ui/QuantityStepper.tsx`, `frontend/src/modules/reports/components/StatusPill.tsx`, `frontend/src/ui/StateDot.tsx` |
| Collapsible feedback and inactive-product sections | `frontend/src/ui/AnimatedCollapse.tsx`, `StoreReportPage.tsx` |
| Submission confirmation | `frontend/src/ui/Dialog.tsx`, `StoreReportPage.tsx` |
| Offline draft persistence and queued edits | `frontend/src/platform/offline/offlineDrafts.ts` |
| Store report endpoint wrappers | `frontend/src/modules/reports/api.ts` |

## Transport

| Behavior | Current implementation |
|---|---|
| One page with tabs «Замовлення / Продукція / Рейси / Автопарк» (URL `?tab=`, only permitted tabs) | `frontend/src/modules/transport/pages/TransportPage.tsx` |
| Orders: date strip, day or period list, order card, status dialog, history, bearers | `components/OrdersPanel.tsx`, `DateStrip.tsx`, `OrderCard.tsx`, `StatusDialog.tsx`, `BearersForm.tsx` |
| Order form with the required fleet car and «Той самий автомобіль» for the bearers | `components/OrderForm.tsx`, `CarPicker.tsx`, `StopsEditor.tsx` |
| Dispatcher: change car, time and stops of an open order | `components/AssignmentForm.tsx` |
| Product requests: list, request card with derived status, form with product search, prices, totals and an optional car; reject | `components/ProductsPanel.tsx`, `RequestCard.tsx`, `RequestForm.tsx`, `RequestStatus.tsx`, `RejectRequestForm.tsx`, `productSearch.ts`, `frontend/src/ui/Combobox.tsx` |
| Dispatcher board: lanes per car, idle cars, unplanned requests | `components/BoardPanel.tsx`, `board.ts` |
| «Додати до рейсу», «Новий рейс», run editor, cargo manifest | `components/AddToRunForm.tsx`, `RunEditor.tsx`, `DispatchDialogs.tsx`, `CargoManifest.tsx`, `cargo.ts` |
| Fleet: list, add a car, deactivate; plate input | `components/FleetPanel.tsx`, `PlateInput.tsx`, `plate.ts` |
| Printable carrying schedule («Схема виносу») | `pages/TransportSchedulePage.tsx` |
| Timing badges and day words; API error mapping | `timing.ts`, `errors.ts` |

## Administration

| Behavior | Current implementation |
|---|---|
| Month page: store register, products matrix, period, submitted-only filter, and XLSX export | `frontend/src/modules/reports/pages/ReportsMonthPage.tsx` (old `/admin/summary` links: `SummaryRedirect.tsx`) |
| Report detail and draft/submitted status update | `frontend/src/modules/reports/pages/AdminReportDetailPage.tsx` |
| «Адміністрування» hub: overview, grouped section menu, shared status message | `frontend/src/platform/admin/` |
| Product catalogue search, price changes, archive/restore, import | `frontend/src/modules/reports/settings/ProductsSection.tsx` |
| Per-organisation «По розрахунку» option | `frontend/src/modules/reports/settings/ReportSettingsSection.tsx` |
| Users, organisations and roles | `frontend/src/platform/access/` |
| «Стан програми» (health, metrics, error log), «Публічний доступ» (Cloudflare Tunnel), «Оновлення програми», «Резервні копії» | `frontend/src/platform/system/` (`HealthSection.tsx`, `TunnelSection.tsx`, `UpdateSection.tsx`, `BackupSection.tsx`) |
| «Сеанси» (signed-in devices, end a session) | `frontend/src/platform/access/SessionsSection.tsx` |
| Management dashboard («Показники») | `frontend/src/modules/management/pages/DashboardPage.tsx`, `components/blocks.tsx` |
| Audit log filters and entries | `frontend/src/platform/audit/AuditLogSection.tsx` |
| Shared API calls and DTO types | `frontend/src/modules/reports/api.ts`, `frontend/src/platform/api/types.ts` |

## Server compatibility and static assets

| Behavior | Current implementation |
|---|---|
| JSON API and authentication endpoints | `internal/web/*.go` (routes registered per area, e.g. `accounts.go`; module endpoints live in `internal/<module>/http.go`), mounted by `internal/web/server.go` |
| REST API error envelopes and minimal non-API error page | `internal/web/errors.go` |
| Offline page, PWA endpoints and `/healthz` | `internal/web/server.go`, `internal/assets/static/` |
| Last-resort SPA routing after API/PWA routes | `internal/web/server.go` |
| Browser styles and theme tokens | `frontend/src/app/index.css`, `frontend/tailwind.config.js` |
| API types | `frontend/src/platform/api/schema.d.ts` (maintained by hand since the Go port) |

## Release verification

Run `go vet ./cmd/... ./internal/... && go test ./cmd/... ./internal/...` from the repository root. Run frontend lint, type checking, tests, and production build from `frontend/` with `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Run the browser check against the real binary with `bash scripts/build_go.sh && go run ./cmd/smoke -exe dist/legkyi -tunnel && CHROMIUM_PATH=/opt/pw-browsers/chromium LEGKYI_E2E_BINARY=dist/legkyi uv run scripts/e2e_test.py` (`CHROMIUM_PATH` reuses an installed Chromium; the e2e test starts the binary on port 8888 with `DEMO=1` and a throwaway data folder).
