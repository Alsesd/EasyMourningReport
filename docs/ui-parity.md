# UI Parity Checklist

This document tracks every action, validation rule, error message, and interaction pattern in the legacy Jinja+Alpine UI and maps it to its implementation in the Single-Page Application.

## 1. Authentication (`app/templates/login.html`, `app/routes/auth.py`)

| Feature / Rule | Legacy Implementation | SPA Implementation | Parity Verified |
|---|---|---|---|
| Login form with username and password | `login.html` form POST `/login` | `frontend/src/pages/LoginPage.tsx` | [x] |
| Invalid credentials error | "Неправильний логін або пароль" (401) | Handled by API client, displayed under form | [x] |
| Archived store account error | "Цей обліковий запис вимкнено. Зверніться до адміністратора." (403) | Handled by API client, displayed under form | [x] |
| Rate-limited error | "Забагато невдалих спроб. Спробуйте пізніше." (429) | Handled by API client, displayed under form | [x] |
| Autofocus on login input | `autofocus` attribute | React `autoFocus` on username field | [x] |
| Logout action | `POST /logout` redirecting to `/login` | `useAuth().logout()`, calls `POST /api/v1/auth/logout` | [x] |

## 2. Store Report Screen (`app/templates/report.html`, `app/static/report-app.js`)

| Feature / Rule | Legacy Implementation | SPA Implementation | Parity Verified |
|---|---|---|---|
| Period navigation (previous/next) | Previous enabled if index > 0; next enabled if index < length - 1 | `StoreReportPage.tsx` period switcher | [x] |
| Status pill | Submitted = "Надіслано" (green), Draft = "Чернетка" (amber), New = "Новий" (neutral) | `StatusPill` component with matching colors | [x] |
| Product card layout | Product name, formatted price (`money(cents)`), stepper input, line total | `ReportItemCard` component | [x] |
| Numeric stepper | `−` decrement (min 0), `+` increment, direct numeric input (`inputMode="numeric"`, 44px min tap target) | `QuantityStepper` component | [x] |
| Repriced products in month | Shows separate row for each price point in month with badge ("стара ціна", "нова ціна", "раніше збережена") | `ReportItemCard` multi-price rendering | [x] |
| Inactive products section | Collapsible `<details>` section, read-only list with line totals and sum | `InactiveProductsSection` component | [x] |
| Sticky footer | Total month amount, "Зберегти чернетку", "Надіслати звіт" | `StickyFooter` component | [x] |
| Unsaved changes indicator | Dirty state tracking comparing against loaded snapshot | Tracked in state, displays "Є незбережені зміни" | [x] |
| Navigation guard | `beforeunload` warning when dirty | `useBlocker` / window `beforeunload` listener | [x] |
| Submit confirmation dialog | Confirmation alert/dialog before locking report | Radix UI / Accessible confirmation modal | [x] |
| Read-only state | Inputs disabled when `report.read_only === true` | All quantity inputs and save buttons disabled | [x] |
| Success feedback | "Чернетку збережено.", "Звіт надіслано й заблоковано..." | Ukrainian toast / inline status message | [x] |
| Offline draft persistence | None in legacy (failed when offline) | IndexedDB / localStorage fallback + sync badge | [x] |

## 3. Admin Summary (`app/templates/summary.html`, `app/static/admin-summary-app.js`)

| Feature / Rule | Legacy Implementation | SPA Implementation | Parity Verified |
|---|---|---|---|
| Period switcher | Month navigation (prev/next) updating query params | `AdminSummaryPage.tsx` | [x] |
| Submitted only filter | Checkbox toggle filtering reports | Filter checkbox in summary header | [x] |
| XLSX Export link | Link to `/admin/summary.xlsx?period=...&submitted_only=...` | Direct link to binary download | [x] |
| KPI summary cards | Total revenue, active stores count, submitted count | KPI metric cards | [x] |
| Stores & products matrix table | Horizontally scrollable responsive table with store totals and grand total | Responsive table with scroll container | [x] |

## 4. Admin Reports (`app/templates/reports.html`, `report_view.html`, `admin-reports-app.js`, `admin-report-detail-app.js`)

| Feature / Rule | Legacy Implementation | SPA Implementation | Parity Verified |
|---|---|---|---|
| Period selector | Prev/next buttons and month selector | `AdminReportsPage.tsx` | [x] |
| Report status pills | Submitted / Draft / None | `StatusPill` with accurate status mapping | [x] |
| Report detail view | Line-by-line view of products, quantities, prices, sums | `AdminReportDetailPage.tsx` | [x] |
| Lock / unlock report toggle | Button toggles between `draft` and `submitted` with confirmation | Status toggle with confirmation modal | [x] |

## 5. Admin Settings & Catalogue (`app/templates/admin.html`, `app/static/admin-app.js`, `app/static/admin.js`)

| Feature / Rule | Legacy Implementation | SPA Implementation | Parity Verified |
|---|---|---|---|
| Product live search | Real-time name filtering (accent & case insensitive) | Instant search filter in `AdminSettingsPage.tsx` | [x] |
| Compact product card | Name, current price, active status, usage count | Product card component | [x] |
| Price editor expand/collapse | Single price input expands into editor with previous price chips | Single price input + history chips | [x] |
| Price change note | Explanatory note: "Нова ціна діятиме з YYYY-MM..." | Dynamic notice based on current admin period | [x] |
| Numeric equivalence | `1.0` and `1.00` treated as identical, save only appears on change | Strict cents comparison | [x] |
| Price update | Updates price and re-renders card without page jump | REST API PUT `/api/v1/admin/products/:id` | [x] |
| Create product | Name and price fields, validation, error/success feedback | Create product form modal / foldout | [x] |
| Archive / restore product | Soft delete if used in reports, hard delete if unused | Archive/restore actions with confirmation | [x] |
| XLSX product import | File upload of `.xlsx` catalogue with result summary | Upload with feedback dialog | [x] |
| Store management | List active/archived stores, create store, update name/login | Store management panel | [x] |
| Store password reset | Dialog/input to reset store password | Password reset modal/form | [x] |
| Admin password change | Form to update administrator password | Admin password section | [x] |
| Cloudflare Tunnel status card | Current status, live public URL, start/stop, autostart toggle | Real-time status card with polling | [x] |
| Backup download | Attachment link to `/admin/backup/download` | Direct server download link | [x] |

## 6. Admin Audit Log (`app/templates/logs.html`, `app/static/admin-logs-app.js`)

| Feature / Rule | Legacy Implementation | SPA Implementation | Parity Verified |
|---|---|---|---|
| Action filter | Select dropdown populated from `/api/v1/admin/log-actions` | Filter select dropdown | [x] |
| Login filter | Text search by user login | Login filter input | [x] |
| Log entries list | Timestamp (uk-UA), User, Role, Action, Details, IP address | Responsive log table/cards | [x] |

## 7. Global Controls & Accessibility

| Feature / Rule | Legacy Implementation | SPA Implementation | Parity Verified |
|---|---|---|---|
| Theme switcher | Light / Dark / System stored in `easyMourningReport.theme` | Theme provider maintaining the same key | [x] |
| Typography | System / web fonts | `@fontsource/onest` self-hosted | [x] |
| Language | Ukrainian only, `Intl` number & currency formatting | `frontend/src/i18n/uk.ts` and `Intl.NumberFormat('uk-UA')` | [x] |
| Touch targets | Min 44px for buttons, inputs, steppers | Strictly 44px min touch target | [x] |
| Keyboard navigation | Visible focus rings (`focus-visible`) | High-contrast focus rings on all interactive elements | [x] |
| Reduced motion | Respect `prefers-reduced-motion` | Media query respected in transitions | [x] |
